export type Lang = "en" | "ur";

export type LandingCopy = {
  dir: "ltr" | "rtl";
  brand: string;
  eyebrowNetwork: string;
  navDoctor: string;
  navAdmin: string;
  navPatient: string;
  navEmergency: string;
  heroTitlePre: string;
  heroTitleHighlight: string;
  heroTitlePost: string;
  heroBody: string;
  badge1: string;
  badge2: string;
  badge3: string;
  scanCta: string;
  scanCtaSub: string;
  twoSystemsEyebrow: string;
  twoSystemsTitle: string;
  doctorPortalTag: string;
  doctorPortalTitle: string;
  doctorPortalBody: string;
  doctorPortalList: string[];
  doctorPortalCta: string;
  patientPortalTag: string;
  patientPortalTitle: string;
  patientPortalBody: string;
  patientPortalList: string[];
  patientPortalCta: string;
  howItWorksEyebrow: string;
  steps: { step: string; title: string; body: string }[];
  securityEyebrow: string;
  securityTitle: string;
  securityList: string[];
  footer: string;
  launcherSub: string;
  launcherPatientLabel: string;
  // Self-service booking — the "Book a meeting" entry point on both the
  // marketing site and the app launcher.
  bookCta: string;
  bookCtaSub: string;
  bookLauncherLabel: string;
  bookLauncherSub: string;
  launcherPatientSub: string;
  launcherDoctorLabel: string;
  launcherDoctorSub: string;
  launcherAdminLabel: string;
  launcherAdminSub: string;
  launcherEmergencyLabel: string;
  launcherEmergencySub: string;
  viewToggleToWebsite: string;
  viewToggleToApp: string;
  langToggle: string;
};

export const landingCopy: Record<Lang, LandingCopy> = {
  en: {
    dir: "ltr" as const,
    brand: "PulseID",
    eyebrowNetwork: "National Health Record Network",
    navDoctor: "Hospital / clinician sign in",
    navAdmin: "Hospital admin",
    navPatient: "My Reports",
    navEmergency: "Emergency Scan",
    heroTitlePre: "One ",
    heroTitleHighlight: "National ID.",
    heroTitlePost: " A lifelong medical record.",
    heroBody:
      "Every visit, diagnosis and prescription — anchored to your CNIC and available instantly to any doctor, at any hospital. In an emergency, the QR already on your CNIC card tells first responders what matters most, and nothing more.",
    badge1: "Your real CNIC card is your emergency ID",
    badge2: "Full patient-visible audit trail",
    badge3: "Independent hospital & patient logins",
    scanCta: "Scan a CNIC for emergency info →",
    scanCtaSub: "No login needed — for first responders and bystanders in an emergency.",
    twoSystemsEyebrow: "Two systems. One shared record.",
    twoSystemsTitle:
      "PulseID is deliberately split into two independent portals, so a hospital's staff and a patient never share a login, a session, or a view of the data.",
    doctorPortalTag: "Hospital / Clinician Portal",
    doctorPortalTitle: "Doctor & Hospital Dashboard",
    doctorPortalBody:
      "For doctors, nurses and hospital front-desk staff. Search any patient by National ID or scan their CNIC to open a full clinical record instantly — history, diagnoses, prescriptions, and the ability to add a new visit.",
    doctorPortalList: [
      "Hospital-affiliated staff accounts, separate from patient logins",
      "A front-desk clerk can register a new patient in seconds — a doctor fills in the clinical details at the visit",
      "Instant patient lookup or QR-based check-in",
      "Add visits, diagnoses and prescriptions on the spot",
    ],
    doctorPortalCta: "Sign in as hospital staff →",
    patientPortalTag: "Patient Portal",
    patientPortalTitle: "My Reports",
    patientPortalBody:
      "View your medical timeline, download your full report, and see exactly who has looked at your record and when — your CNIC card is already your emergency ID, nothing extra to carry.",
    patientPortalList: [
      "Scan your CNIC to sign in — no password to remember",
      "A one-time code is sent to your phone to confirm it's really you",
      "Registered once by a doctor or hospital clerk — never yourself",
      "A transparent audit log of every doctor view and QR scan",
    ],
    patientPortalCta: "Open My Reports →",
    howItWorksEyebrow: "How it works",
    steps: [
      {
        step: "01",
        title: "Registered once, at any hospital",
        body: "A doctor or front-desk clerk registers a patient against their National ID — name, contact details and emergency contacts on the spot, with blood group and medical history added by a doctor at the visit. Every hospital after this one sees the same record.",
      },
      {
        step: "02",
        title: "Looked up instantly, anywhere",
        body: "Any clinician can search by National ID or scan the patient's CNIC card to pull up the full history in seconds — no faxed files, no repeat paperwork.",
      },
      {
        step: "03",
        title: "Protected in an emergency",
        body: "A first responder scanning the patient's CNIC sees only blood group, allergies, conditions and emergency contacts — never the full record — and every scan is logged to the patient's own audit trail.",
      },
    ],
    securityEyebrow: "Built to be trusted, not just demoed",
    securityTitle:
      "Every access is logged, emergency lookups only ever expose the essentials, and every login is rate-limited.",
    securityList: [
      "Doctor and patient sessions are fully independent — separate cookies, separate JWTs, separately re-verified on every API call",
      "Emergency lookups (by CNIC or PulseID QR) return only life-critical fields — never diagnoses, prescriptions, or visit history",
      "OTP logins lock out after 5 incorrect attempts; brute-force login and lookup attempts are rate-limited",
      "Patients see a live, timestamped audit log of every doctor view and CNIC/QR scan against their record",
    ],
    footer:
      "Hackathon prototype — hospital/clinician login: ayesha.raza@pulseid.dev / doctor123. My Reports: any seeded National ID, code shown on screen in demo mode.",
    // Launcher (installed-app) screen
    launcherSub: "Sign in to continue",
    launcherPatientLabel: "My Reports",
    bookCta: "Book a meeting",
    bookCtaSub:
      "New here? Request an appointment with a doctor — send your details and any reports you already have, and they'll confirm a time for you.",
    bookLauncherLabel: "Book a meeting",
    bookLauncherSub: "Request an appointment with a doctor",
    launcherPatientSub: "Sign in as a patient",
    launcherDoctorLabel: "Doctor / Clinician",
    launcherDoctorSub: "Hospital staff sign in",
    launcherAdminLabel: "Hospital Admin",
    launcherAdminSub: "Manage doctors & accounts",
    launcherEmergencyLabel: "Emergency Scan",
    launcherEmergencySub: "No login needed",
    // Toggles
    viewToggleToWebsite: "About PulseID",
    viewToggleToApp: "Back to app",
    langToggle: "اردو",
  },
  ur: {
    dir: "rtl" as const,
    brand: "پلس آئی ڈی",
    eyebrowNetwork: "قومی صحت ریکارڈ نیٹ ورک",
    navDoctor: "ہسپتال / معالج سائن ان",
    navAdmin: "ہسپتال ایڈمن",
    navPatient: "میری رپورٹس",
    navEmergency: "ایمرجنسی اسکین",
    heroTitlePre: "ایک ",
    heroTitleHighlight: "قومی شناختی کارڈ۔",
    heroTitlePost: " ایک تاحیات طبی ریکارڈ۔",
    heroBody:
      "ہر وزٹ، تشخیص اور نسخہ — آپ کے شناختی کارڈ سے منسلک اور کسی بھی ڈاکٹر، کسی بھی ہسپتال میں فوری دستیاب۔ ایمرجنسی میں، آپ کے شناختی کارڈ پر موجود QR کوڈ ابتدائی طبی امداد دینے والوں کو صرف وہی بتاتا ہے جو ضروری ہے، اس سے زیادہ کچھ نہیں۔",
    badge1: "آپ کا اصل شناختی کارڈ ہی آپ کی ایمرجنسی شناخت ہے",
    badge2: "مکمل مریض کو نظر آنے والا آڈٹ لاگ",
    badge3: "ہسپتال اور مریض کے لیے علیحدہ لاگ ان",
    scanCta: "ایمرجنسی معلومات کے لیے شناختی کارڈ اسکین کریں ←",
    scanCtaSub: "کوئی لاگ ان درکار نہیں — ابتدائی امدادی کارکنوں اور راہگیروں کے لیے۔",
    twoSystemsEyebrow: "دو نظام۔ ایک مشترکہ ریکارڈ۔",
    twoSystemsTitle:
      "پلس آئی ڈی کو جان بوجھ کر دو آزاد پورٹلز میں تقسیم کیا گیا ہے، تاکہ ہسپتال کا عملہ اور مریض کبھی بھی ایک ہی لاگ ان، سیشن یا ڈیٹا کا نظارہ شیئر نہ کریں۔",
    doctorPortalTag: "ہسپتال / معالج پورٹل",
    doctorPortalTitle: "ڈاکٹر اور ہسپتال ڈیش بورڈ",
    doctorPortalBody:
      "ڈاکٹروں، نرسوں اور ہسپتال کے فرنٹ ڈیسک عملے کے لیے۔ کسی بھی مریض کو قومی شناختی نمبر سے تلاش کریں یا فوری طور پر مکمل طبی ریکارڈ کھولنے کے لیے ان کا شناختی کارڈ اسکین کریں — تاریخ، تشخیص، نسخے، اور نیا وزٹ شامل کرنے کی سہولت۔",
    doctorPortalList: [
      "ہسپتال سے وابستہ عملے کے اکاؤنٹس، مریض کے لاگ ان سے علیحدہ",
      "فرنٹ ڈیسک کلرک سیکنڈوں میں نیا مریض رجسٹر کر سکتا ہے — طبی تفصیلات ڈاکٹر وزٹ کے وقت درج کرتا ہے",
      "فوری مریض تلاش یا QR پر مبنی چیک اِن",
      "موقع پر ہی وزٹ، تشخیص اور نسخے شامل کریں",
    ],
    doctorPortalCta: "ہسپتال عملے کے طور پر سائن ان کریں ←",
    patientPortalTag: "مریض پورٹل",
    patientPortalTitle: "میری رپورٹس",
    patientPortalBody:
      "اپنی طبی ٹائم لائن دیکھیں، مکمل رپورٹ ڈاؤن لوڈ کریں، اور بالکل معلوم کریں کہ آپ کا ریکارڈ کس نے اور کب دیکھا — آپ کا شناختی کارڈ پہلے ہی آپ کی ایمرجنسی شناخت ہے، کچھ اضافی رکھنے کی ضرورت نہیں۔",
    patientPortalList: [
      "سائن ان کرنے کے لیے اپنا شناختی کارڈ اسکین کریں — کوئی پاس ورڈ یاد رکھنے کی ضرورت نہیں",
      "یہ تصدیق کرنے کے لیے کہ یہ واقعی آپ ہیں، آپ کے فون پر ایک وقتی کوڈ بھیجا جاتا ہے",
      "صرف ایک بار ڈاکٹر یا ہسپتال کلرک کے ذریعے رجسٹر — کبھی خود نہیں",
      "ہر ڈاکٹر ویو اور QR اسکین کا شفاف آڈٹ لاگ",
    ],
    patientPortalCta: "میری رپورٹس کھولیں ←",
    howItWorksEyebrow: "یہ کیسے کام کرتا ہے",
    steps: [
      {
        step: "۰۱",
        title: "کسی بھی ہسپتال میں ایک بار رجسٹریشن",
        body: "ایک ڈاکٹر یا فرنٹ ڈیسک کلرک مریض کو اس کے قومی شناختی نمبر کے خلاف رجسٹر کرتا ہے — نام، رابطہ تفصیلات اور ایمرجنسی رابطے موقع پر، بلڈ گروپ اور طبی تاریخ ڈاکٹر وزٹ کے وقت شامل کرتا ہے۔ اس کے بعد ہر ہسپتال وہی ریکارڈ دیکھتا ہے۔",
      },
      {
        step: "۰۲",
        title: "کہیں بھی، فوری طور پر تلاش",
        body: "کوئی بھی معالج قومی شناختی نمبر سے تلاش کر سکتا ہے یا سیکنڈوں میں مکمل تاریخ حاصل کرنے کے لیے مریض کا شناختی کارڈ اسکین کر سکتا ہے — نہ فیکس فائلیں، نہ دہرائے جانے والے کاغذات۔",
      },
      {
        step: "۰۳",
        title: "ایمرجنسی میں محفوظ",
        body: "مریض کا شناختی کارڈ اسکین کرنے والا ابتدائی امدادی کارکن صرف بلڈ گروپ، الرجی، امراض اور ایمرجنسی رابطے دیکھتا ہے — کبھی مکمل ریکارڈ نہیں — اور ہر اسکین مریض کے اپنے آڈٹ لاگ میں درج ہوتا ہے۔",
      },
    ],
    securityEyebrow: "صرف ڈیمو کے لیے نہیں، بھروسے کے لیے بنایا گیا",
    securityTitle:
      "ہر رسائی کا اندراج ہوتا ہے، ایمرجنسی تلاش صرف ضروری معلومات ظاہر کرتی ہے، اور ہر لاگ ان کی شرح محدود ہے۔",
    securityList: [
      "ڈاکٹر اور مریض کے سیشن مکمل طور پر آزاد ہیں — علیحدہ کوکیز، علیحدہ JWTs، ہر API کال پر علیحدہ تصدیق",
      "ایمرجنسی تلاش (شناختی کارڈ یا پلس آئی ڈی QR کے ذریعے) صرف جان بچانے والی معلومات ظاہر کرتی ہے — کبھی تشخیص، نسخے یا وزٹ کی تاریخ نہیں",
      "غلط کوڈ کی 5 کوششوں کے بعد OTP لاگ ان بند ہو جاتا ہے؛ زبردستی لاگ ان اور تلاش کی کوششیں محدود ہیں",
      "مریض ہر ڈاکٹر ویو اور QR اسکین کا لائیو، وقت کے ساتھ آڈٹ لاگ دیکھتے ہیں",
    ],
    footer:
      "ہیکاتھون پروٹو ٹائپ — ہسپتال/معالج لاگ ان: ayesha.raza@pulseid.dev / doctor123۔ میری رپورٹس: کوئی بھی نمونہ قومی شناختی نمبر، کوڈ ڈیمو موڈ میں اسکرین پر دکھایا جاتا ہے۔",
    launcherSub: "جاری رکھنے کے لیے سائن ان کریں",
    launcherPatientLabel: "میری رپورٹس",
    bookCta: "ملاقات بک کریں",
    bookCtaSub:
      "نئے ہیں؟ ڈاکٹر سے اپائنٹمنٹ کی درخواست کریں — اپنی تفصیلات اور موجودہ رپورٹس بھیجیں، وہ آپ کے لیے وقت کی تصدیق کریں گے۔",
    bookLauncherLabel: "ملاقات بک کریں",
    bookLauncherSub: "ڈاکٹر سے اپائنٹمنٹ کی درخواست",
    launcherPatientSub: "مریض کے طور پر سائن ان کریں",
    launcherDoctorLabel: "ڈاکٹر / معالج",
    launcherDoctorSub: "ہسپتال کا عملہ سائن ان کرے",
    launcherAdminLabel: "ہسپتال ایڈمن",
    launcherAdminSub: "ڈاکٹرز اور اکاؤنٹس کا انتظام کریں",
    launcherEmergencyLabel: "ایمرجنسی اسکین",
    launcherEmergencySub: "لاگ ان درکار نہیں",
    viewToggleToWebsite: "پلس آئی ڈی کے بارے میں",
    viewToggleToApp: "ایپ پر واپس جائیں",
    langToggle: "English",
  },
};
