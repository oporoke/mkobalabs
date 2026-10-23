// Public privacy notice (item 40): /faragha (Swahili) and /privacy (English).
// PRIVACY_CONTACT and DATA_LOCATION (+ optional DATA_LOCATION_SW) come from .env; lines are left out if they are not set.
const { esc, page } = require('./html');

function body(lang) {
  const contact = process.env.PRIVACY_CONTACT;
  const location = lang === 'en' ? process.env.DATA_LOCATION : (process.env.DATA_LOCATION_SW || process.env.DATA_LOCATION);
  if (lang === 'en') {
    return `
<h1>Mkoba: how your data is used</h1>
<p><a href="/faragha">Soma kwa Kiswahili</a></p>
<h2>What we store</h2>
<p>Your WhatsApp phone number, the name and type of business you give us, the messages you send to Mkoba, and the records made from them: sales, purchases, expenses, debts (including the names of people in your debt records), mobile-money messages you paste, your stock counts, the phone numbers of customers you send receipts to, with their purchases and points, your product list, orders customers send you (their name, phone number and delivery location), your bulk-buy group and orders, and your location if you share it to find a collection point.</p>
<h2>Why</h2>
<p>Only to keep your business records and send you your summaries. We ask for your agreement before recording anything.</p>
<h2>Who sees it</h2>
<p>You, through WhatsApp and your dashboard. The Mkoba team, only to run and support the service. We do not sell your data or share it with anyone else. Messages pass through WhatsApp (Meta), and the data is stored on our server provider's computers${location ? ` in ${esc(location)}` : ''}.</p>
<h2>How long</h2>
<p>Until you delete it. Backup copies are kept for 14 days and then deleted automatically.</p>
<h2>Your choices</h2>
<ul>
<li>See your records: send <b>dashboard</b>, or <b>today</b>, <b>week</b>, <b>month</b>.</li>
<li>Fix a record: send <b>correct 6000</b> or <b>undo</b>.</li>
<li>Delete everything: send <b>DELETE MY DATA</b>, then confirm with <b>DELETE EVERYTHING</b>.</li>
<li>Stop evening summaries: send <b>STOP REPORTS</b>.</li>
</ul>
${contact ? `<h2>Contact</h2><p>Questions about your data: ${esc(contact)}</p>` : ''}`;
  }
  return `
<h1>Mkoba: jinsi taarifa zako zinavyotumika</h1>
<p><a href="/privacy">Read in English</a></p>
<h2>Tunachohifadhi</h2>
<p>Namba yako ya WhatsApp, jina na aina ya biashara unayotupa, ujumbe unaotuma kwa Mkoba, na rekodi zinazotokana nao: mauzo, manunuzi, matumizi, madeni (pamoja na majina ya watu kwenye rekodi za madeni), ujumbe wa pesa ya simu unaobandika, hesabu za stoo, namba za simu za wateja unaowapa risiti pamoja na ununuzi na pointi zao, orodha ya bidhaa zako, oda wanazotuma wateja (jina, namba ya simu na mahali pa kuletewa), kikundi chako cha kununua jumla na oda zake, na eneo lako ukilituma ili kupata sehemu ya kuchukua mzigo.</p>
<h2>Kwa nini</h2>
<p>Ili kuweka hesabu za biashara yako na kukutumia muhtasari wako tu. Tunaomba ukubali kabla ya kuhifadhi chochote.</p>
<h2>Nani anaziona</h2>
<p>Wewe, kupitia WhatsApp na dashibodi yako. Timu ya Mkoba, kwa ajili ya kuendesha huduma na kukusaidia tu. Hatuuzi taarifa zako wala kuzitoa kwa mtu mwingine. Ujumbe hupita kupitia WhatsApp (Meta), na taarifa huhifadhiwa kwenye kompyuta za kampuni inayotupa seva${location ? ` iliyopo ${esc(location)}` : ''}.</p>
<h2>Kwa muda gani</h2>
<p>Mpaka utakapozifuta. Nakala za akiba (backup) hukaa siku 14, kisha hujifuta zenyewe.</p>
<h2>Uamuzi wako</h2>
<ul>
<li>Kuona rekodi zako: tuma <b>dashibodi</b>, au <b>leo</b>, <b>wiki</b>, <b>mwezi</b>.</li>
<li>Kurekebisha rekodi: tuma <b>rekebisha 6000</b> au <b>futa</b>.</li>
<li>Kufuta kila kitu: tuma <b>FUTA DATA</b>, kisha thibitisha kwa <b>FUTA KABISA</b>.</li>
<li>Kusitisha muhtasari wa jioni: tuma <b>ACHA RIPOTI</b>.</li>
</ul>
${contact ? `<h2>Mawasiliano</h2><p>Maswali kuhusu taarifa zako: ${esc(contact)}</p>` : ''}`;
}

const privacyPage = lang => (_req, res) =>
  res.send(page(lang === 'en' ? 'Mkoba privacy' : 'Faragha ya Mkoba', `<article class="prose">${body(lang)}</article>`));

module.exports = { privacyPage };
