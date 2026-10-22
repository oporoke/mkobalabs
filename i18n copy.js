// All vendor-facing WhatsApp wording, in Swahili (sw, default) and English (en). Item 37.
const T = {
  sw: {
    labels: { sale: 'mauzo', purchase: 'manunuzi', expense: 'matumizi' },
    of: 'ya',
    debtLabels: {
      credit_given: n => `deni la ${n} (anadaiwa)`,
      credit_received: n => `deni lako kwa ${n}`,
      repayment_received: n => `malipo kutoka kwa ${n}`,
      repayment_made: n => `malipo kwa ${n}`,
    },
    savedOne: (d, a) => `Sawa! Nimeongeza ${d} ${a}. Asante!`,
    savedMany: lines => `Sawa! Nimeongeza:\n${lines}\nAsante!`,
    notUnderstood: what => `Samahani, sikuelewa vizuri${what}. Ulitumia/uliuza kiasi gani, TSh ngapi?`,
    pending: lines => `Nimeelewa hivi:\n${lines}\nNi sahihi? Jibu NDIO au HAPANA.`,
    rejected: 'Sawa, sijahifadhi. Tafadhali tuma tena kwa usahihi, mfano: nimenunua mchele 25000',
    nothingToChange: 'Hakuna rekodi ya kubadilisha.',
    deletedOne: (d, a) => `Nimefuta ${d} ${a}.`,
    deletedMany: lines => `Nimefuta:\n${lines}`,
    askNewAmount: 'Andika kiasi kipya, mfano: rekebisha 6000',
    groupTooBig: n => `Ujumbe wako wa mwisho ulikuwa na rekodi ${n}. Andika "futa" kisha utume tena kwa usahihi.`,
    corrected: (d, from, to) => `Nimerekebisha ${d}: ${from} → ${to}.`,
    periods: { leo: 'leo', jana: 'jana', wiki: 'wiki hii', mwezi: 'mwezi huu', salio: 'tangu mwanzo' },
    summaryTitle: t => `📊 Muhtasari wa ${t}:`,
    sales: 'Mauzo', purchases: 'Manunuzi', expenses: 'Matumizi', profit: 'Faida', loss: 'Hasara',
    noRecordsPeriod: t => `Hakuna rekodi za ${t} bado.`,
    noRecords: 'Hakuna rekodi bado.',
    help: [
      'Mkoba - jinsi ya kutumia:',
      '• Rekodi: nimeuza 5000, nimenunua unga 20000, nimelipa nauli 2000',
      '• Muhtasari: leo, jana, wiki, mwezi, salio',
      '• Madeni: Juma ananidai 5000, namdai Juma 5000, Juma amelipa 2000, nimemlipa Juma 2000',
      '• Kuona madeni: madeni, au deni Juma',
      '• Ripoti ya jioni: ACHA RIPOTI / ANZA RIPOTI',
      '• Dashibodi ya mtandaoni: dashibodi',
      '• Kufuta rekodi ya mwisho: futa',
      '• Kubadilisha kiasi cha mwisho: rekebisha 6000',
      '• Lugha: english / kiswahili',
      '• Kufuta taarifa zako zote: FUTA DATA',
      '• Msaada: msaada',
    ].join('\n'),
    owesYou: (n, a) => `${n} anadaiwa ${a}`,
    youOwe: (n, a) => `Unadaiwa na ${n} ${a}`,
    settled: n => `Hakuna deni kati yako na ${n}`,
    debtsTitle: '📒 Madeni:', owedToYou: 'Unaowadai:', youOweHeading: 'Wanaokudai:', noDebts: 'Hakuna madeni.',
    noRecordsFor: n => `Hakuna rekodi za ${n}.`,
    debtAction: {
      credit_given: (n, a) => `${n} anadaiwa ${a}`,
      credit_received: (n, a) => `Unadaiwa na ${n} ${a}`,
      repayment_received: (n, a) => `${n} amelipa ${a}`,
      repayment_made: (n, a) => `Umemlipa ${n} ${a}`,
    },
    debtSaved: (action, balance) => `Sawa! ${action}.\nSalio: ${balance}.`,
    askDebtAmount: text => `Kiasi gani? Mfano: ${text} 5000`,
    welcome: 'Karibu Mkoba! 👋 Nitakusaidia kuweka hesabu za biashara yako kupitia WhatsApp.\nKwanza, jina lako ni nani?',
    askBusiness: n => `Asante ${n}! Unafanya biashara gani? (mfano: chakula, duka, mboga, nguo)\nAndika "ruka" kuruka swali hili.`,
    onboarded: n => `Safi, ${n}! Sasa uko tayari.`,
    skipped: 'Sawa.',
    reportsOn: 'Sawa! Utapokea muhtasari kila jioni saa 3 usiku.',
    reportsOff: 'Sawa, nimesitisha ripoti za jioni. Kuwasha tena, andika ANZA RIPOTI.',
    reportGreeting: n => `Habari ${n}!`,
    reportFooter: 'Kusitisha ripoti hizi, andika ACHA RIPOTI.',
    someone: 'mfanyabiashara',
    dashboardLink: (mins, url) => `Fungua dashibodi yako hapa (kiungo kinafanya kazi kwa dakika ${mins}, mara moja tu):\n${url}`,
    audioHint: 'Samahani, bado siwezi kusikiliza ujumbe wa sauti. Tafadhali andika, mfano: nimeuza 5000',
    textOnlyHint: 'Samahani, ninaelewa ujumbe wa maandishi tu. Andika, mfano: nimeuza 5000 au nimenunua unga 20000',
    systemError: 'Samahani, kuna tatizo la mfumo. Tafadhali tuma tena baada ya muda mfupi.',
    languageSet: 'Sawa, nitajibu kwa Kiswahili. Kwa Kiingereza, tuma ENGLISH.',
    mmIgnored: {
      own_transfer: 'Huu ni uhamisho wa pesa zako mwenyewe, si mauzo wala gharama. Sijauweka kwenye hesabu.',
      loan: 'Haya ni malipo ya mkopo, si mauzo wala gharama. Sijayaweka kwenye hesabu.',
      card: 'Huu ni ujumbe wa kadi ya benki, si pesa ya simu. Sijauweka kwenye hesabu.',
      currency: 'Mkoba inaweka hesabu kwa TSh tu. Ujumbe huu si wa TSh, kwa hiyo sijauweka.',
    },
    mmDuplicate: ref => `Muamala huu (${ref}) tayari umeshawekwa kwenye hesabu.`,
    mmAskKind: (amt, name, fee) => `Umetuma ${amt} kwa ${name}${fee ? ` (ada ${fee})` : ''}. Hii ni nini?\n1 - Manunuzi (bidhaa za biashara)\n2 - Matumizi ya biashara\n3 - Si ya biashara (binafsi)\nJibu 1, 2 au 3.`,
    mmChooseAgain: 'Tafadhali jibu 1 (manunuzi), 2 (matumizi) au 3 (binafsi).',
    mmPersonal: 'Sawa, sijauweka kwenye hesabu za biashara.',
    consentPrompt: url => 'Karibu Mkoba! 👋 Nitakusaidia kuweka hesabu za biashara yako kupitia WhatsApp.\n\n'
      + 'Ili kufanya hivyo, Mkoba itahifadhi namba yako ya simu, jina lako, na rekodi unazotuma (mauzo, manunuzi, matumizi, madeni). '
      + 'Taarifa hizi ni zako: hatuziuzi wala kuzitoa kwa mtu mwingine, isipokuwa kwa watoa huduma wanaotuwezesha (WhatsApp na seva yetu). '
      + `Unaweza kuzifuta zote wakati wowote kwa kuandika FUTA DATA.\nSoma zaidi: ${url}\n\nJibu NAKUBALI kuendelea.`,
    consentReminder: url => `Kabla ya kuanza, tafadhali kubali masharti ya taarifa zako. Soma hapa: ${url}\nJibu NAKUBALI kuendelea.`,
    consentThanksNew: 'Asante! Kwanza, jina lako ni nani?',
    consentThanksExisting: 'Asante! Sasa unaweza kuendelea kutumia Mkoba.',
    deletionWarn: mins => `Hii itafuta KABISA jina lako, rekodi zako zote, madeni na ujumbe wako wote kwenye Mkoba. Haiwezi kurudishwa.\nKuthibitisha, andika FUTA KABISA ndani ya dakika ${mins}.`,
    deletionNoRequest: 'Hakuna ombi la kufuta linalosubiri. Kufuta taarifa zako, andika kwanza FUTA DATA.',
    deletionDone: 'Taarifa zako zote zimefutwa. Nakala za akiba (backup) hujifuta zenyewe ndani ya siku 14. Ukituma ujumbe tena, utaanza upya.',
  },
  en: {
    labels: { sale: 'sale', purchase: 'purchase', expense: 'expense' },
    of: 'of',
    debtLabels: {
      credit_given: n => `${n}'s debt (owes you)`,
      credit_received: n => `your debt to ${n}`,
      repayment_received: n => `payment from ${n}`,
      repayment_made: n => `payment to ${n}`,
    },
    savedOne: (d, a) => `Done! Added ${d} ${a}. Thanks!`,
    savedMany: lines => `Done! Added:\n${lines}\nThanks!`,
    notUnderstood: what => `Sorry, I didn't understand${what}. How much did you sell or spend, in TSh?`,
    pending: lines => `I understood:\n${lines}\nIs this right? Reply YES or NO.`,
    rejected: 'OK, not saved. Please send it again, e.g.: bought rice 25000',
    nothingToChange: 'There is no entry to change.',
    deletedOne: (d, a) => `Deleted ${d} ${a}.`,
    deletedMany: lines => `Deleted:\n${lines}`,
    askNewAmount: 'Send the new amount, e.g.: correct 6000',
    groupTooBig: n => `Your last message had ${n} entries. Send "undo", then send it again correctly.`,
    corrected: (d, from, to) => `Corrected ${d}: ${from} → ${to}.`,
    periods: { leo: 'today', jana: 'yesterday', wiki: 'this week', mwezi: 'this month', salio: 'all time' },
    summaryTitle: t => `📊 Summary for ${t}:`,
    sales: 'Sales', purchases: 'Purchases', expenses: 'Expenses', profit: 'Profit', loss: 'Loss',
    noRecordsPeriod: t => `No records for ${t} yet.`,
    noRecords: 'No records yet.',
    help: [
      'Mkoba - how to use:',
      '• Record: sold 5000, bought flour 20000, paid fare 2000',
      '• Summary: today, yesterday, week, month, balance',
      '• Debts: Juma owes me 5000, I owe Juma 5000, Juma paid 2000',
      '• See debts: debts, or debt Juma',
      '• Evening report: STOP REPORTS / START REPORTS',
      '• Online dashboard: dashboard',
      '• Delete the last entry: undo',
      '• Change the last amount: correct 6000',
      '• Language: kiswahili / english',
      '• Delete all your data: DELETE MY DATA',
      '• Help: help',
    ].join('\n'),
    owesYou: (n, a) => `${n} owes you ${a}`,
    youOwe: (n, a) => `You owe ${n} ${a}`,
    settled: n => `You and ${n} are settled`,
    debtsTitle: '📒 Debts:', owedToYou: 'They owe you:', youOweHeading: 'You owe:', noDebts: 'No debts.',
    noRecordsFor: n => `No records for ${n}.`,
    debtAction: {
      credit_given: (n, a) => `${n} owes you ${a}`,
      credit_received: (n, a) => `You owe ${n} ${a}`,
      repayment_received: (n, a) => `${n} paid ${a}`,
      repayment_made: (n, a) => `You paid ${n} ${a}`,
    },
    debtSaved: (action, balance) => `Done! ${action}.\nBalance: ${balance}.`,
    askDebtAmount: text => `How much? E.g.: ${text} 5000`,
    welcome: "Welcome to Mkoba! 👋 I'll help you keep your business accounts on WhatsApp.\nFirst, what's your name?",
    askBusiness: n => `Thanks ${n}! What business do you do? (e.g. food, shop, vegetables, clothes)\nSend "skip" to skip this question.`,
    onboarded: n => `Great, ${n}! You're all set.`,
    skipped: 'OK.',
    reportsOn: "Done! You'll get a summary every evening at 9 pm.",
    reportsOff: 'OK, evening reports are off. To turn them back on, send START REPORTS.',
    reportGreeting: n => `Hello ${n}!`,
    reportFooter: 'To stop these reports, send STOP REPORTS.',
    someone: 'there',
    dashboardLink: (mins, url) => `Open your dashboard here (the link works for ${mins} minutes, once only):\n${url}`,
    audioHint: "Sorry, I can't listen to voice notes yet. Please type, e.g.: sold 5000",
    textOnlyHint: 'Sorry, I only understand text messages. Type, e.g.: sold 5000 or bought flour 20000',
    systemError: 'Sorry, something went wrong on our side. Please send it again in a moment.',
    languageSet: "OK, I'll reply in English. For Swahili, send KISWAHILI.",
    mmIgnored: {
      own_transfer: "This moves your own money; it's not a sale or a cost. Not added to your records.",
      loan: "This is a loan repayment, not a sale or a cost. Not added to your records.",
      card: 'This is a bank card message, not mobile money. Not added to your records.',
      currency: "Mkoba keeps records in TSh only. This message isn't in TSh, so it was not added.",
    },
    mmDuplicate: ref => `This transaction (${ref}) is already in your records.`,
    mmAskKind: (amt, name, fee) => `You sent ${amt} to ${name}${fee ? ` (fee ${fee})` : ''}. What was it?\n1 - Purchase (stock for the business)\n2 - Business expense\n3 - Not business (personal)\nReply 1, 2 or 3.`,
    mmChooseAgain: 'Please reply 1 (purchase), 2 (expense) or 3 (personal).',
    mmPersonal: 'OK, not added to your business records.',
    consentPrompt: url => "Welcome to Mkoba! 👋 I'll help you keep your business accounts on WhatsApp.\n\n"
      + 'To do that, Mkoba stores your phone number, your name, and the records you send (sales, purchases, expenses, debts). '
      + "This data is yours: we don't sell it or give it to anyone, except the services that make Mkoba work (WhatsApp and our server). "
      + `You can delete all of it at any time by sending DELETE MY DATA.\nRead more: ${url}\n\nReply I AGREE to continue.`,
    consentReminder: url => `Before we start, please agree to how your data is used. Read it here: ${url}\nReply I AGREE to continue.`,
    consentThanksNew: "Thank you! First, what's your name?",
    consentThanksExisting: 'Thank you! You can keep using Mkoba.',
    deletionWarn: mins => `This will PERMANENTLY delete your name, all your records, debts and messages in Mkoba. It can't be undone.\nTo confirm, send DELETE EVERYTHING within ${mins} minutes.`,
    deletionNoRequest: 'There is no deletion request waiting. To delete your data, first send DELETE MY DATA.',
    deletionDone: 'All your data has been deleted. Backup copies delete themselves within 14 days. If you message again, you will start fresh.',
  },
};

const t = lang => T[lang] || T.sw;

// --- language detection: switch only on a clearly one-language message ---
const EN_WORDS = new Set(['sold', 'sell', 'sale', 'sales', 'bought', 'buy', 'purchase', 'purchased', 'paid', 'pay', 'spent',
  'expense', 'expenses', 'today', 'yesterday', 'week', 'month', 'balance', 'total', 'help', 'menu', 'undo', 'delete',
  'correct', 'edit', 'yes', 'no', 'owes', 'owe', 'lent', 'debts', 'debt', 'stop', 'start', 'reports', 'my', 'name', 'is',
  'i', 'am', 'hello', 'hi', 'thanks', 'thank', 'you', 'for', 'the', 'of', 'and', 'skip', 'dashboard', 'fare', 'rent', 'flour']);
const SW_WORDS = new Set(['leo', 'jana', 'wiki', 'mwezi', 'salio', 'msaada', 'futa', 'rekebisha', 'badilisha', 'ndio', 'ndiyo',
  'hapana', 'habari', 'asante', 'naitwa', 'jina', 'langu', 'ni', 'kwa', 'ya', 'na', 'deni', 'madeni', 'ripoti', 'acha', 'anza',
  'dashibodi', 'shilingi', 'elfu', 'laki', 'mia', 'buku', 'mauzo', 'manunuzi', 'matumizi', 'gharama', 'nauli', 'kodi', 'unga',
  'mchele', 'ruka', 'mambo', 'sawa', 'nauza', 'mimi', 'chakula', 'duka']);
// Swahili verb forms only (not names like Alice, Anastasia): ni/tu/wa + tense + stem, a/u + tense + known stem, debt verbs.
const SW_VERB = /^(?:ni|tu|wa)(?:me|li|na|ta)[a-z]{3,}$|^(?:a|u)(?:me|li|na|ta)(?:ni|m)?(?:lipa|dai|kopa|rudish|nunua|uza|tumia|pata|pokea)[a-z]*$|^nam(?:dai|lipa|kopesha|rudishia)[a-z]*$/;

const LANG_SWITCH = { english: 'en', kiingereza: 'en', 'in english': 'en', kiswahili: 'sw', swahili: 'sw', 'kwa kiswahili': 'sw' };

function parseLanguageSwitch(text) {
  return LANG_SWITCH[String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()] || null;
}

// 'en' / 'sw' when the message is clearly in one language, else null (keep the current language).
function detectLanguage(text) {
  const words = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
  let en = 0, sw = 0;
  for (const w of words) {
    if (EN_WORDS.has(w)) en++;
    else if (SW_WORDS.has(w) || SW_VERB.test(w)) sw++;
  }
  if (en > 0 && sw === 0) return 'en';
  if (sw > 0 && en === 0) return 'sw';
  return null;
}

module.exports = { t, detectLanguage, parseLanguageSwitch };
