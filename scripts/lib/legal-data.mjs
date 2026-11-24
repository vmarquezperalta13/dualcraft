// Tables for the legal/privacy pack: data categories (mapped to Apple's privacy manifest/labels and Google's Data safety),
// purposes, legal bases, SDK detection and well-known processors. Texts in Spanish and English.

export const CATEGORIES = {
  name: { apple: 'Name', google: 'Personal info › Name', es: 'Nombre', en: 'Name' },
  email: { apple: 'EmailAddress', google: 'Personal info › Email address', es: 'Correo electrónico', en: 'Email address' },
  phone: { apple: 'PhoneNumber', google: 'Personal info › Phone number', es: 'Teléfono', en: 'Phone number' },
  address: { apple: 'PhysicalAddress', google: 'Personal info › Address', es: 'Dirección postal', en: 'Physical address' },
  birthdate: { apple: 'OtherUserContactInfo', google: 'Personal info › Other info', es: 'Fecha de nacimiento', en: 'Date of birth' },
  user_id: { apple: 'UserID', google: 'Personal info › User IDs', es: 'Identificador de usuario', en: 'User ID' },
  device_id: { apple: 'DeviceID', google: 'Device or other IDs', es: 'Identificadores del dispositivo', en: 'Device identifiers' },
  precise_location: { apple: 'PreciseLocation', google: 'Location › Precise location', es: 'Ubicación precisa', en: 'Precise location' },
  coarse_location: { apple: 'CoarseLocation', google: 'Location › Approximate location', es: 'Ubicación aproximada', en: 'Approximate location' },
  photos: { apple: 'PhotosorVideos', google: 'Photos and videos › Photos', es: 'Fotos y vídeos', en: 'Photos and videos' },
  audio: { apple: 'AudioData', google: 'Audio files › Voice or sound recordings', es: 'Grabaciones de audio', en: 'Audio recordings' },
  contacts: { apple: 'Contacts', google: 'Contacts', es: 'Contactos', en: 'Contacts' },
  user_content: { apple: 'OtherUserContent', google: 'App activity › Other user-generated content', es: 'Contenido que creas en la app', en: 'Content you create in the app' },
  purchase_history: { apple: 'PurchaseHistory', google: 'Financial info › Purchase history', es: 'Historial de compras', en: 'Purchase history' },
  payment_info: { apple: 'PaymentInfo', google: 'Financial info › User payment info', es: 'Datos de pago', en: 'Payment information' },
  product_interaction: { apple: 'ProductInteraction', google: 'App activity › App interactions', es: 'Uso de la app', en: 'App usage' },
  search_history: { apple: 'SearchHistory', google: 'App activity › In-app search history', es: 'Búsquedas en la app', en: 'In-app searches' },
  crash_data: { apple: 'CrashData', google: 'App info and performance › Crash logs', es: 'Registros de errores', en: 'Crash logs' },
  performance: { apple: 'PerformanceData', google: 'App info and performance › Diagnostics', es: 'Datos de rendimiento', en: 'Performance data' },
  advertising_data: { apple: 'AdvertisingData', google: 'App activity › Other actions', es: 'Datos publicitarios', en: 'Advertising data' },
  health: { apple: 'Health', google: 'Health and fitness › Health info', es: 'Datos de salud', en: 'Health data', special: true },
  fitness: { apple: 'Fitness', google: 'Health and fitness › Fitness info', es: 'Datos de actividad física', en: 'Fitness data' },
  sensitive: { apple: 'SensitiveInfo', google: 'Personal info › Other info', es: 'Datos sensibles', en: 'Sensitive data', special: true },
}

export const PURPOSES = {
  app_functionality: { apple: 'AppFunctionality', google: 'App functionality', es: 'Prestar el servicio de la app', en: 'Providing the app\'s service' },
  account: { apple: 'AppFunctionality', google: 'Account management', es: 'Crear y gestionar tu cuenta', en: 'Creating and managing your account' },
  payments: { apple: 'AppFunctionality', google: 'App functionality', es: 'Gestionar compras y suscripciones', en: 'Managing purchases and subscriptions' },
  notifications: { apple: 'AppFunctionality', google: 'Developer communications', es: 'Enviarte notificaciones', en: 'Sending you notifications' },
  analytics: { apple: 'Analytics', google: 'Analytics', es: 'Medir el uso para mejorar la app', en: 'Measuring usage to improve the app' },
  personalization: { apple: 'ProductPersonalization', google: 'Personalization', es: 'Personalizar tu experiencia', en: 'Personalizing your experience' },
  advertising: { apple: 'ThirdPartyAdvertising', google: 'Advertising or marketing', es: 'Mostrar publicidad', en: 'Showing advertising' },
  marketing: { apple: 'DeveloperAdvertising', google: 'Advertising or marketing', es: 'Comunicaciones comerciales', en: 'Marketing communications' },
  security: { apple: 'AppFunctionality', google: 'Fraud prevention, security, and compliance', es: 'Seguridad y prevención del fraude', en: 'Security and fraud prevention' },
}

export const BASES = {
  contract: { es: 'Ejecución del contrato (art. 6.1.b RGPD)', en: 'Performance of a contract (Art. 6(1)(b) GDPR)' },
  consent: { es: 'Consentimiento (art. 6.1.a RGPD), que puedes retirar en cualquier momento', en: 'Consent (Art. 6(1)(a) GDPR), which you can withdraw at any time' },
  legitimate_interest: { es: 'Interés legítimo (art. 6.1.f RGPD)', en: 'Legitimate interest (Art. 6(1)(f) GDPR)' },
  legal_obligation: { es: 'Obligación legal (art. 6.1.c RGPD)', en: 'Legal obligation (Art. 6(1)(c) GDPR)' },
}

export const PROCESSORS = {
  firebase: { name: 'Google Ireland Ltd. (Firebase)', country: 'IE', transfer: 'EU-US Data Privacy Framework y cláusulas contractuales tipo', privacy: 'https://firebase.google.com/support/privacy', es: 'Infraestructura, base de datos, autenticación y notificaciones', en: 'Infrastructure, database, authentication and notifications' },
  google_analytics: { name: 'Google Ireland Ltd. (Google Analytics / Firebase Analytics)', country: 'IE', transfer: 'EU-US Data Privacy Framework', privacy: 'https://policies.google.com/privacy', es: 'Analítica de uso', en: 'Usage analytics' },
  google_ads: { name: 'Google Ireland Ltd. (AdMob)', country: 'IE', transfer: 'EU-US Data Privacy Framework', privacy: 'https://policies.google.com/technologies/ads', es: 'Publicidad', en: 'Advertising' },
  meta: { name: 'Meta Platforms Ireland Ltd.', country: 'IE', transfer: 'EU-US Data Privacy Framework', privacy: 'https://www.facebook.com/privacy/policy', es: 'Publicidad y medición', en: 'Advertising and measurement' },
  supabase: { name: 'Supabase Inc.', country: 'US', transfer: 'Cláusulas contractuales tipo (datos alojados en la región del proyecto)', privacy: 'https://supabase.com/privacy', es: 'Infraestructura, base de datos y autenticación', en: 'Infrastructure, database and authentication' },
  revenuecat: { name: 'RevenueCat Inc.', country: 'US', transfer: 'EU-US Data Privacy Framework / cláusulas contractuales tipo', privacy: 'https://www.revenuecat.com/privacy', es: 'Gestión de suscripciones', en: 'Subscription management' },
  stripe: { name: 'Stripe Payments Europe Ltd.', country: 'IE', transfer: 'EU-US Data Privacy Framework', privacy: 'https://stripe.com/privacy', es: 'Pagos', en: 'Payments' },
  apple: { name: 'Apple Distribution International Ltd.', country: 'IE', transfer: 'Cláusulas contractuales tipo', privacy: 'https://www.apple.com/legal/privacy/', es: 'Compras dentro de la app (App Store)', en: 'In-app purchases (App Store)' },
  google_play: { name: 'Google Ireland Ltd. (Google Play)', country: 'IE', transfer: 'EU-US Data Privacy Framework', privacy: 'https://policies.google.com/privacy', es: 'Compras dentro de la app (Google Play)', en: 'In-app purchases (Google Play)' },
  sentry: { name: 'Functional Software Inc. (Sentry)', country: 'US', transfer: 'EU-US Data Privacy Framework', privacy: 'https://sentry.io/privacy/', es: 'Registro de errores', en: 'Error tracking' },
  mixpanel: { name: 'Mixpanel Inc.', country: 'US', transfer: 'EU-US Data Privacy Framework', privacy: 'https://mixpanel.com/legal/privacy-policy', es: 'Analítica de uso', en: 'Usage analytics' },
  amplitude: { name: 'Amplitude Inc.', country: 'US', transfer: 'EU-US Data Privacy Framework', privacy: 'https://amplitude.com/privacy', es: 'Analítica de uso', en: 'Usage analytics' },
  posthog: { name: 'PostHog Inc.', country: 'US', transfer: 'Cláusulas contractuales tipo (o alojamiento en la UE)', privacy: 'https://posthog.com/privacy', es: 'Analítica de uso', en: 'Usage analytics' },
  vercel: { name: 'Vercel Inc.', country: 'US', transfer: 'EU-US Data Privacy Framework', privacy: 'https://vercel.com/legal/privacy-policy', es: 'Alojamiento web y analítica sin cookies', en: 'Web hosting and cookieless analytics' },
  netlify: { name: 'Netlify Inc.', country: 'US', transfer: 'EU-US Data Privacy Framework', privacy: 'https://www.netlify.com/privacy/', es: 'Alojamiento web', en: 'Web hosting' },
  cloudflare: { name: 'Cloudflare Inc.', country: 'US', transfer: 'EU-US Data Privacy Framework', privacy: 'https://www.cloudflare.com/privacypolicy/', es: 'Alojamiento web y seguridad', en: 'Web hosting and security' },
  expo: { name: '650 Industries Inc. (Expo)', country: 'US', transfer: 'Cláusulas contractuales tipo', privacy: 'https://expo.dev/privacy', es: 'Compilación y actualizaciones de la app', en: 'App builds and updates' },
}
export const EEA = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO'])

// SDKs found in dependency files → what they collect (suggestions: always reviewed with the user)
const d = (category, purposes, legalBasis, extra = {}) => ({ category, purposes, legalBasis, linked: true, ...extra })
export const SDKS = [
  { re: /firebase_auth|@react-native-firebase\/auth|firebase-auth|FirebaseAuth|['"]firebase\/auth['"]/, name: 'Firebase Authentication', processor: 'firebase', data: [d('email', ['account'], 'contract'), d('user_id', ['account'], 'contract')], auth: true },
  { re: /cloud_firestore|@react-native-firebase\/firestore|firebase-firestore|FirebaseFirestore|['"]firebase\/firestore['"]/, name: 'Cloud Firestore', processor: 'firebase', data: [d('user_content', ['app_functionality'], 'contract')] },
  { re: /firebase_analytics|@react-native-firebase\/analytics|firebase-analytics|FirebaseAnalytics|['"]firebase\/analytics['"]/, name: 'Firebase Analytics', processor: 'google_analytics', data: [d('product_interaction', ['analytics'], 'consent'), d('device_id', ['analytics'], 'consent')], cookies: true },
  { re: /firebase_crashlytics|@react-native-firebase\/crashlytics|firebase-crashlytics|FirebaseCrashlytics/, name: 'Firebase Crashlytics', processor: 'firebase', data: [d('crash_data', ['app_functionality'], 'legitimate_interest', { linked: false }), d('performance', ['app_functionality'], 'legitimate_interest', { linked: false })] },
  { re: /firebase_messaging|@react-native-firebase\/messaging|firebase-messaging|FirebaseMessaging/, name: 'Firebase Cloud Messaging', processor: 'firebase', data: [d('device_id', ['notifications'], 'consent')] },
  { re: /supabase_flutter|@supabase\/supabase-js|supabase-kt|supabase-swift|io\.github\.jan-tennert\.supabase/, name: 'Supabase', processor: 'supabase', data: [d('email', ['account'], 'contract'), d('user_id', ['account'], 'contract')], auth: true },
  { re: /in_app_purchase|com\.android\.billingclient|react-native-iap|expo-iap|StoreKit/, name: 'Store billing', processor: null, data: [d('purchase_history', ['payments'], 'contract')] },
  { re: /purchases_flutter|react-native-purchases|com\.revenuecat|RevenueCat/, name: 'RevenueCat', processor: 'revenuecat', data: [d('purchase_history', ['payments'], 'contract'), d('user_id', ['payments'], 'contract')] },
  { re: /google_mobile_ads|react-native-google-mobile-ads|play-services-ads|GoogleMobileAds/, name: 'Google AdMob', processor: 'google_ads', data: [d('advertising_data', ['advertising'], 'consent', { tracking: true }), d('device_id', ['advertising'], 'consent', { tracking: true })], tracking: true },
  { re: /facebook_app_events|react-native-fbsdk|facebook-android-sdk|FBSDKCoreKit|FacebookCore/, name: 'Meta SDK', processor: 'meta', data: [d('advertising_data', ['advertising'], 'consent', { tracking: true }), d('device_id', ['advertising'], 'consent', { tracking: true })], tracking: true },
  { re: /geolocator|\blocation:|expo-location|react-native-geolocation|play-services-location|CoreLocation/, name: 'Location', processor: null, data: [d('precise_location', ['app_functionality'], 'consent')], permission: 'location' },
  { re: /image_picker|expo-image-picker|react-native-image-picker|PhotosUI/, name: 'Photo picker', processor: null, data: [d('photos', ['app_functionality'], 'contract')], permission: 'photos' },
  { re: /\bcamera:|expo-camera|react-native-vision-camera|mobile_scanner|AVFoundation/, name: 'Camera', processor: null, data: [], permission: 'camera' },
  { re: /flutter_contacts|contacts_service|expo-contacts|react-native-contacts|\bContacts\b/, name: 'Contacts', processor: null, data: [d('contacts', ['app_functionality'], 'consent')], permission: 'contacts' },
  { re: /record:|flutter_sound|expo-av|react-native-audio/, name: 'Microphone', processor: null, data: [d('audio', ['app_functionality'], 'consent')], permission: 'microphone' },
  { re: /sentry_flutter|@sentry\/|io\.sentry|Sentry/, name: 'Sentry', processor: 'sentry', data: [d('crash_data', ['app_functionality'], 'legitimate_interest', { linked: false }), d('performance', ['app_functionality'], 'legitimate_interest', { linked: false })] },
  { re: /mixpanel/i, name: 'Mixpanel', processor: 'mixpanel', data: [d('product_interaction', ['analytics'], 'consent')], cookies: true },
  { re: /amplitude/i, name: 'Amplitude', processor: 'amplitude', data: [d('product_interaction', ['analytics'], 'consent')], cookies: true },
  { re: /posthog/i, name: 'PostHog', processor: 'posthog', data: [d('product_interaction', ['analytics'], 'consent')], cookies: true },
  { re: /@vercel\/analytics/, name: 'Vercel Analytics', processor: 'vercel', data: [d('product_interaction', ['analytics'], 'legitimate_interest', { linked: false })] },
  { re: /@stripe\/|stripe_sdk|flutter_stripe|stripe-android|StripePaymentSheet/, name: 'Stripe', processor: 'stripe', data: [d('payment_info', ['payments'], 'contract'), d('purchase_history', ['payments'], 'contract')], cookies: true },
  { re: /gtag\(|googletagmanager\.com|@next\/third-parties|react-ga4|vue-gtag/, name: 'Google Analytics (web)', processor: 'google_analytics', data: [d('product_interaction', ['analytics'], 'consent'), d('device_id', ['analytics'], 'consent')], cookies: true },
]

export const KNOWN_COOKIES = {
  'Google Analytics (web)': [{ name: '_ga', category: 'analytics', duration: '2 años / 2 years' }, { name: '_ga_<ID>', category: 'analytics', duration: '2 años / 2 years' }],
  'Firebase Analytics': [{ name: '_ga', category: 'analytics', duration: '2 años / 2 years' }],
  Stripe: [{ name: '__stripe_mid', category: 'necessary', duration: '1 año / 1 year' }, { name: '__stripe_sid', category: 'necessary', duration: '30 min' }],
  Mixpanel: [{ name: 'mp_<token>_mixpanel', category: 'analytics', duration: '1 año / 1 year' }],
  Amplitude: [{ name: 'AMP_<key>', category: 'analytics', duration: '1 año / 1 year' }],
  PostHog: [{ name: 'ph_<key>_posthog', category: 'analytics', duration: '1 año / 1 year' }],
}

// iOS Info.plist usage descriptions per permission
export const IOS_USAGE = {
  location: ['NSLocationWhenInUseUsageDescription'],
  photos: ['NSPhotoLibraryUsageDescription'],
  camera: ['NSCameraUsageDescription'],
  contacts: ['NSContactsUsageDescription'],
  microphone: ['NSMicrophoneUsageDescription'],
}

export const COOKIE_CATEGORIES = { necessary: { es: 'Técnicas (necesarias)', en: 'Strictly necessary' }, preferences: { es: 'Preferencias', en: 'Preferences' }, analytics: { es: 'Analíticas', en: 'Analytics' }, marketing: { es: 'Publicidad', en: 'Advertising' } }
