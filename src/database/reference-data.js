'use strict';
// Reference data required for the platform to work (not sample data).

const CITIES = [
  ['Delhi', 'Delhi', 28.6139, 77.209],
  ['Mumbai', 'Maharashtra', 19.076, 72.8777],
  ['Pune', 'Maharashtra', 18.5204, 73.8567],
  ['Bengaluru', 'Karnataka', 12.9716, 77.5946],
  ['Hyderabad', 'Telangana', 17.385, 78.4867],
  ['Chennai', 'Tamil Nadu', 13.0827, 80.2707],
  ['Kolkata', 'West Bengal', 22.5726, 88.3639],
  ['Ahmedabad', 'Gujarat', 23.0225, 72.5714],
  ['Jaipur', 'Rajasthan', 26.9124, 75.7873],
  ['Lucknow', 'Uttar Pradesh', 26.8467, 80.9462],
  ['Varanasi', 'Uttar Pradesh', 25.3176, 82.9739],
  ['Indore', 'Madhya Pradesh', 22.7196, 75.8577],
  ['Bhopal', 'Madhya Pradesh', 23.2599, 77.4126],
  ['Nagpur', 'Maharashtra', 21.1458, 79.0882],
  ['Haridwar', 'Uttarakhand', 29.9457, 78.1642],
  ['Noida', 'Uttar Pradesh', 28.5355, 77.391],
  ['Gurugram', 'Haryana', 28.4595, 77.0266],
  ['Chandigarh', 'Chandigarh', 30.7333, 76.7794],
  ['Patna', 'Bihar', 25.5941, 85.1376],
  ['Surat', 'Gujarat', 21.1702, 72.8311],
];

const CATEGORIES = [
  ['Griha Pravesh', 'griha-pravesh', 'Housewarming puja to bless a new home before moving in.', 'bi-house-heart'],
  ['Satyanarayan Puja', 'satyanarayan-puja', 'Satyanarayan Katha and puja for prosperity and gratitude.', 'bi-book'],
  ['Rudrabhishek', 'rudrabhishek', 'Abhishek of Lord Shiva with sacred offerings and Rudri path.', 'bi-droplet-half'],
  ['Ganesh Puja', 'ganesh-puja', 'Invocation of Lord Ganesha for auspicious beginnings.', 'bi-stars'],
  ['Vastu Shanti', 'vastu-shanti', 'Puja to harmonise the energies of a home or workplace.', 'bi-compass'],
  ['Wedding Ceremony', 'wedding-ceremony', 'Vivah sanskar with all traditional rituals.', 'bi-heart'],
  ['Mundan Sanskar', 'mundan-sanskar', 'First hair-cutting ceremony for a child.', 'bi-emoji-smile'],
  ['Navgraha Shanti', 'navgraha-shanti', 'Puja to pacify the nine planets.', 'bi-globe2'],
  ['Havan', 'havan', 'Sacred fire ritual for purification and blessings.', 'bi-fire'],
  ['Festival Puja', 'festival-puja', 'Diwali Lakshmi puja, Navratri, Janmashtami and other festivals.', 'bi-brightness-high'],
];

const LANGUAGES = ['Hindi', 'Sanskrit', 'English', 'Marathi', 'Gujarati', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Punjabi', 'Odia', 'Bhojpuri', 'Maithili'];

const DEFAULT_SETTINGS = {
  cancellation_hours: '24',          // customers may cancel up to this many hours before the ceremony
  min_lead_hours: '12',              // earliest a booking can start from now
  max_advance_days: '180',           // furthest date a booking can be made for
  document_retention_days: '90',     // verification documents are purged this many days after a decision
  support_email: 'support@panditfinder.example',
  support_phone: '+91 00000 00000',
  allow_new_pandit_applications: '1',
};

module.exports = { CITIES, CATEGORIES, LANGUAGES, DEFAULT_SETTINGS };
