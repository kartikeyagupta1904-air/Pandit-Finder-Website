'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { badRequest } = require('../utils/errors');

const PHOTO_MAX = 2 * 1024 * 1024;
const DOC_MAX = 5 * 1024 * 1024;

const photoDir = () => path.join(config.uploadDir, 'photos');
// Private documents are stored outside /public and only streamed to admins after an authorization check.
const privateDir = () => path.join(config.uploadDir, 'private');

// Files are held in memory (bounded by the limits below), content-sniffed, then written with a random name.
const memory = multer.memoryStorage();

const applicationUpload = multer({
  storage: memory,
  limits: { fileSize: DOC_MAX, files: 4, fields: 40, fieldSize: 64 * 1024 },
}).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'identity_document', maxCount: 1 },
  { name: 'certificate_document', maxCount: 1 },
]);

const photoUpload = multer({ storage: memory, limits: { fileSize: PHOTO_MAX, files: 1 } }).single('photo');
const documentUpload = multer({ storage: memory, limits: { fileSize: DOC_MAX, files: 1, fields: 5 } }).single('document');

/** Detect the real type from magic bytes — the browser-provided MIME type is not trusted. */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (buf.slice(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  return null;
}

function savePhoto(file) {
  if (file.size > PHOTO_MAX) throw badRequest('Profile photo must be 2 MB or smaller.');
  const type = sniff(file.buffer);
  if (!type || type.mime === 'application/pdf') throw badRequest('Profile photo must be a JPG, PNG or WebP image.');
  fs.mkdirSync(photoDir(), { recursive: true });
  const name = crypto.randomBytes(16).toString('hex') + type.ext;
  fs.writeFileSync(path.join(photoDir(), name), file.buffer);
  return name;
}

function saveDocument(file) {
  if (file.size > DOC_MAX) throw badRequest('Documents must be 5 MB or smaller.');
  const type = sniff(file.buffer);
  if (!type) throw badRequest('Documents must be PDF, JPG, PNG or WebP files.');
  fs.mkdirSync(privateDir(), { recursive: true });
  const name = crypto.randomBytes(24).toString('hex') + type.ext;
  fs.writeFileSync(path.join(privateDir(), name), file.buffer, { mode: 0o600 });
  return { stored_name: name, mime_type: type.mime, size_bytes: file.size, original_name: path.basename(file.originalname).slice(0, 120) };
}

function removePhoto(name) {
  if (!name || name.includes('/') || name.includes('\\')) return;
  fs.rm(path.join(photoDir(), name), { force: true }, () => {});
}

function documentPath(storedName) {
  return path.join(privateDir(), path.basename(storedName));
}

/** Wraps a multer middleware so its errors become friendly 400 responses. */
function handle(mw) {
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'A file is too large (photos up to 2 MB, documents up to 5 MB).' : `Upload error: ${err.message}`;
      return next(badRequest(msg));
    }
    next(err);
  });
}

module.exports = {
  applicationUpload: handle(applicationUpload),
  photoUpload: handle(photoUpload),
  documentUpload: handle(documentUpload),
  savePhoto, saveDocument, removePhoto, documentPath, photoDir, privateDir, sniff,
};
