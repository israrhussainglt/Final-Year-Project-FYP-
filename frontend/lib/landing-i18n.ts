// Copy for the two landing views: the installed-app launcher and the
// marketing website. English and Urdu are kept side by side; the website
// strings mirror the designed layout one-to-one (hero, trust strip,
// responder ledger, portals, steps, security panel).

export type Lang = "en" | "ur";

export type LandingCopy = {
  dir: "ltr" | "rtl";
  brand: string;
  langToggle: string;
  viewToggleToWebsite: string;
  viewToggleToApp: string;

  // ---------- Launcher (installed-app default view) ----------
  launcherSub: string;
  bookLauncherLabel: string;
  bookLauncherSub: string;
  launcherPatientLabel: string;
  launcherPatientSub: string;
  launcherDoctorLabel: string;
  launcherDoctorSub: string;
  launcherAdminLabel: string;
  launcherAdminSub: string;
  launcherEmergencyLabel: string;
  launcherEmergencySub: string;

  // ---------- Website ----------
  // Nav
  navAriaLabel: string;
  navEmergency: string;
  navLogin: string;
  navDoctor: string;
  navAdmin: string;
  navPatient: string;
  loginDescDoctor: string;
  loginDescAdmin: string;
  loginDescPatient: string;

  // Hero
  heroTitlePre: string;
  heroTitleHighlight: string;
  heroTitlePost: string;
  heroLede: string;
  heroCtaRecords: string;
  heroCtaDoctor: string;
  quietNew: string;
  bookLink: string;
  // Hero stage (illustrative CNIC + emergency phone)
  stageCardTop1: string;
  stageCardTop2: string;
  stageCardName: string;
  stageCardNid: string;
  stageLinked: string;
  emergencyView: string;
  bloodLabel: string;
  allergiesLabel: string;
  conditionsLabel: string;
  contactLabel: string;
  contactValue: string;
  privacyLine: string;

  // Trust strip
  trust1: string;
  trust2: string;
  trust3: string;
  trust4: string;

  // Responder ledger
  responderTitle: string;
  responderBody: string;
  ledgerNid: string;
  bloodValue: string;
  allowedBlood: string;
  allergiesValue: string;
  allowedAllergies: string;
  conditionsValue: string;
  allowedConditions: string;
  contactsValue: string;
  allowedContacts: string;
  stopLabel: string;
  lockedDiagnoses: string;
  lockedPrescriptions: string;
  lockedVisits: string;
  lockedReports: string;

  // Portals
  portalDoctorTitle: string;
  portalDoctorBody: string;
  portalDoctorCta: string;
  portalPatientTitle: string;
  portalPatientBody: string;
  portalPatientCta: string;

  // Steps
  stepsTitle: string;
  step1Title: string;
  step1Body: string;
  step2Title: string;
  step2Body: string;
  step3Title: string;
  step3Body: string;

  // Security panel
  securityTitle: string;
  security1Title: string;
  security1Body: string;
  security2Title: string;
  security2Body: string;
  security3Title: string;
  security3Body: string;
  security4Title: string;
  security4Body: string;

  // Footer
  footerLine: string;
  footerDemoLabel: string;
  footerDemoBody: string;
};

export const landingCopy: Record<Lang, LandingCopy> = {
  en: {
    dir: "ltr" as const,
    brand: "PulseID",
    langToggle: "اردو",
    viewToggleToWebsite: "About PulseID",
    viewToggleToApp: "Back to app",

    launcherSub: "Sign in to continue",
    bookLauncherLabel: "Book a meeting",
    bookLauncherSub: "Request an appointment with a doctor",
    launcherPatientLabel: "My Reports",
    launcherPatientSub: "Sign in as a patient",
    launcherDoctorLabel: "Doctor / Clinician",
    launcherDoctorSub: "Hospital staff sign in",
    launcherAdminLabel: "Hospital Admin",
    launcherAdminSub: "Manage doctors & accounts",
    launcherEmergencyLabel: "Emergency Scan",
    launcherEmergencySub: "No login needed",

    navAriaLabel: "Portals",
    navEmergency: "Emergency Scan",
    navLogin: "Log in",
    navDoctor: "Hospital / clinician sign in",
    navAdmin: "Hospital admin",
    navPatient: "My Reports",
    loginDescDoctor: "Search patients and add visits",
    loginDescAdmin: "Manage staff and hospital settings",
    loginDescPatient: "View your timeline and audit log",

    heroTitlePre: "One ",
    heroTitleHighlight: "National ID.",
    heroTitlePost: " A lifelong medical record.",
    heroLede:
      "Every visit, diagnosis and prescription is tied to your CNIC and ready for any doctor, at any hospital. In an emergency, the QR on your card shows first responders only what they need to save your life.",
    heroCtaRecords: "View my records",
    heroCtaDoctor: "I'm a clinician",
    quietNew: "New here?",
    bookLink: "Request an appointment",
    stageCardTop1: "Islamic Republic of Pakistan",
    stageCardTop2: "National Identity Card",
    stageCardName: "Hira Malik",
    stageCardNid: "35202-1234567-8",
    stageLinked: "PulseID linked",
    emergencyView: "Emergency view",
    bloodLabel: "Blood group",
    allergiesLabel: "Allergies",
    conditionsLabel: "Conditions",
    contactLabel: "Emergency contact",
    contactValue: "Sana Raza, 0300 ••• 4421",
    privacyLine: "Full record stays private",

    trust1: "Every access is logged",
    trust2: "Separate staff and patient sessions",
    trust3: "Codes lock after 5 wrong tries",
    trust4: "Emergency scans show essentials only",

    responderTitle: "A responder sees four facts. Nothing else.",
    responderBody:
      "Emergency lookups are limited to life-critical fields. Every scan is logged to the patient's own audit trail.",
    ledgerNid: "35202-•••••••-8",
    bloodValue: "B+",
    allowedBlood: "Blood group",
    allergiesValue: "Penicillin",
    allowedAllergies: "Allergies",
    conditionsValue: "Type 2 diabetes",
    allowedConditions: "Chronic conditions",
    contactsValue: "Sana Raza",
    allowedContacts: "Emergency contacts",
    stopLabel: "Emergency scan stops here",
    lockedDiagnoses: "Diagnoses",
    lockedPrescriptions: "Prescriptions",
    lockedVisits: "Visit history",
    lockedReports: "Reports and test results",

    portalDoctorTitle: "I'm a clinician",
    portalDoctorBody:
      "Search any patient by National ID, read the full history and add a visit, diagnosis or prescription on the spot.",
    portalDoctorCta: "Sign in as hospital staff",
    portalPatientTitle: "I'm a patient",
    portalPatientBody:
      "See your timeline, download your report and check who has viewed your record. Sign in with your CNIC and a one-time code.",
    portalPatientCta: "Open My Reports",

    stepsTitle: "Register once. Use it everywhere.",
    step1Title: "Register at any hospital",
    step1Body: "A doctor or front-desk clerk adds you against your National ID in seconds.",
    step2Title: "Get looked up anywhere",
    step2Body: "Any clinician finds your full history by CNIC. No faxed files, no repeat paperwork.",
    step3Title: "Stay protected in an emergency",
    step3Body: "Responders scan your card and see the essentials. You see the scan in your audit log.",

    securityTitle: "Every access is logged. Every login is limited.",
    security1Title: "Separate portals",
    security1Body:
      "Staff and patients never share a login, session or cookie. Each is re-verified on every request.",
    security2Title: "Live audit trail",
    security2Body:
      "Patients see a timestamped log of every doctor view and every CNIC scan on their record.",
    security3Title: "Locked after 5 wrong codes",
    security3Body:
      "One-time codes lock out after five incorrect attempts. Login and lookup attempts are rate-limited.",
    security4Title: "Essentials only in emergencies",
    security4Body:
      "CNIC and QR lookups return life-critical fields and never diagnoses, prescriptions or history.",

    footerLine: "PulseID · National Health Record Network",
    footerDemoLabel: "Demo access",
    footerDemoBody:
      "Clinician: ayesha.raza@pulseid.dev / doctor123 — My Reports: any seeded National ID, code shown on screen.",
  },

  ur: {
    dir: "rtl" as const,
    brand: "پلس آئی ڈی",
    langToggle: "English",
    viewToggleToWebsite: "پلس آئی ڈی کے بارے میں",
    viewToggleToApp: "ایپ پر واپس جائیں",

    launcherSub: "جاری رکھنے کے لیے سائن ان کریں",
    bookLauncherLabel: "ملاقات بک کریں",
    bookLauncherSub: "ڈاکٹر سے اپائنٹمنٹ کی درخواست",
    launcherPatientLabel: "میری رپورٹس",
    launcherPatientSub: "مریض کے طور پر سائن ان کریں",
    launcherDoctorLabel: "ڈاکٹر / معالج",
    launcherDoctorSub: "ہسپتال کا عملہ سائن ان کرے",
    launcherAdminLabel: "ہسپتال ایڈمن",
    launcherAdminSub: "ڈاکٹرز اور اکاؤنٹس کا انتظام کریں",
    launcherEmergencyLabel: "ایمرجنسی اسکین",
    launcherEmergencySub: "لاگ ان درکار نہیں",

    navAriaLabel: "پورٹلز",
    navEmergency: "ہنگامی اسکین",
    navLogin: "لاگ اِن",
    navDoctor: "ہسپتال / معالج لاگ اِن",
    navAdmin: "ہسپتال ایڈمن",
    navPatient: "میری رپورٹس",
    loginDescDoctor: "مریض تلاش کریں اور وزٹ شامل کریں",
    loginDescAdmin: "عملہ اور ہسپتال کی سیٹنگز سنبھالیں",
    loginDescPatient: "اپنی ٹائم لائن اور آڈٹ لاگ دیکھیں",

    heroTitlePre: "ایک ",
    heroTitleHighlight: "قومی شناخت۔",
    heroTitlePost: " زندگی بھر کا طبی ریکارڈ۔",
    heroLede:
      "ہر وزٹ، تشخیص اور نسخہ آپ کے شناختی کارڈ سے جڑا ہے اور کسی بھی ہسپتال کا ڈاکٹر اسے فوراً دیکھ سکتا ہے۔ ہنگامی صورت میں کارڈ پر موجود QR صرف وہی معلومات دکھاتا ہے جو جان بچانے کے لیے ضروری ہیں۔",
    heroCtaRecords: "میرا ریکارڈ دیکھیں",
    heroCtaDoctor: "میں معالج ہوں",
    quietNew: "نئے ہیں؟",
    bookLink: "ملاقات کی درخواست دیں",
    stageCardTop1: " اسلامی جمہوریہ پاکستان",
    stageCardTop2: "قومی شناختی کارڈ",
    stageCardName: "حرا ملک",
    stageCardNid: "35202-1234567-8",
    stageLinked: "پلس آئی ڈی منسلک",
    emergencyView: "ہنگامی منظر",
    bloodLabel: "بلڈ گروپ",
    allergiesLabel: "الرجی",
    conditionsLabel: "بیماریاں",
    contactLabel: "ہنگامی رابطہ",
    contactValue: "ثنا رضا، 0300 ••• 4421",
    privacyLine: "مکمل ریکارڈ محفوظ رہتا ہے",

    trust1: "ہر رسائی درج ہوتی ہے",
    trust2: "عملہ اور مریض کے الگ سیشن",
    trust3: "5 غلط کوششوں پر کوڈ لاک",
    trust4: "ہنگامی اسکین میں صرف بنیادی معلومات",

    responderTitle: "ریسپانڈر کو صرف چار بنیادی باتیں نظر آتی ہیں۔",
    responderBody:
      "ہنگامی تلاش صرف جان بچانے والی معلومات تک محدود ہے۔ ہر اسکین مریض کے اپنے آڈٹ ریکارڈ میں درج ہوتا ہے۔",
    ledgerNid: "35202-•••••••-8",
    bloodValue: "B+",
    allowedBlood: "بلڈ گروپ",
    allergiesValue: "پنسلین",
    allowedAllergies: "الرجی",
    conditionsValue: "ذیابیٹس ٹائپ 2",
    allowedConditions: "دائمی بیماریاں",
    contactsValue: "ثنا رضا",
    allowedContacts: "ہنگامی رابطے",
    stopLabel: "ہنگامی اسکین یہاں رک جاتا ہے",
    lockedDiagnoses: "تشخیص",
    lockedPrescriptions: "نسخے",
    lockedVisits: "وزٹ کی تاریخ",
    lockedReports: "رپورٹس اور ٹیسٹ کے نتائج",

    portalDoctorTitle: "میں معالج ہوں",
    portalDoctorBody:
      "قومی شناختی نمبر سے کوئی بھی مریض تلاش کریں، مکمل تاریخ پڑھیں اور موقع پر وزٹ، تشخیص یا نسخہ شامل کریں۔",
    portalDoctorCta: "ہسپتال عملے کے طور پر لاگ اِن کریں",
    portalPatientTitle: "میں مریض ہوں",
    portalPatientBody:
      "اپنی ٹائم لائن دیکھیں، رپورٹ ڈاؤن لوڈ کریں اور جانیں کہ آپ کا ریکارڈ کس نے دیکھا۔ شناختی کارڈ اور ایک بار استعمال ہونے والے کوڈ سے لاگ اِن کریں۔",
    portalPatientCta: "میری رپورٹس کھولیں",

    stepsTitle: "ایک بار رجسٹر ہوں۔ ہر جگہ استعمال کریں۔",
    step1Title: "کسی بھی ہسپتال میں رجسٹر ہوں",
    step1Body: "ڈاکٹر یا فرنٹ ڈیسک کلرک چند سیکنڈ میں آپ کو آپ کے شناختی نمبر سے رجسٹر کر دیتا ہے۔",
    step2Title: "کہیں بھی تلاش کریں",
    step2Body: "کوئی بھی معالج شناختی نمبر سے آپ کی مکمل تاریخ دیکھ سکتا ہے۔ فیکس یا دوبارہ کاغذی کارروائی نہیں۔",
    step3Title: "ہنگامی صورت میں محفوظ",
    step3Body: "ریسپانڈر کارڈ اسکین کر کے بنیادی معلومات دیکھتا ہے۔ آپ اسکین اپنے آڈٹ لاگ میں دیکھتے ہیں۔",

    securityTitle: "ہر رسائی درج ہوتی ہے۔ ہر لاگ اِن محدود ہے۔",
    security1Title: "الگ الگ پورٹل",
    security1Body: "عملہ اور مریض کبھی ایک لاگ اِن، سیشن یا کوکی شیئر نہیں کرتے۔ ہر درخواست پر الگ تصدیق ہوتی ہے۔",
    security2Title: "لائیو آڈٹ ٹریل",
    security2Body: "مریض اپنے ریکارڈ پر ہر ڈاکٹر کے وزٹ اور ہر کارڈ اسکین کا وقت کے ساتھ ریکارڈ دیکھتے ہیں۔",
    security3Title: "5 غلط کوڈ کے بعد لاک",
    security3Body: "ایک بار استعمال ہونے والا کوڈ پانچ غلط کوششوں کے بعد لاک ہو جاتا ہے۔ لاگ اِن اور تلاش کی کوششیں بھی محدود ہیں۔",
    security4Title: "ہنگامی صورت میں صرف بنیادی معلومات",
    security4Body: "کارڈ اور QR تلاش صرف جان بچانے والی معلومات دیتی ہے، تشخیص، نسخے یا تاریخ نہیں۔",

    footerLine: "پلس آئی ڈی · قومی صحت ریکارڈ نیٹ ورک",
    footerDemoLabel: "ڈیمو رسائی",
    footerDemoBody:
      "ہسپتال/معالج: ayesha.raza@pulseid.dev / doctor123 — میری رپورٹس: کوئی بھی نمونہ قومی شناختی نمبر، کوڈ ڈیمو موڈ میں اسکرین پر۔",
  },
};
