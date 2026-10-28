# HVAC Voice AI Agent — मार्केट रिसर्च, प्राइसिंग और वेबसाइट साइटमैप

> रिसर्च की तारीख: 26 अक्टूबर 2026 · टारगेट मार्केट: अमेरिका (US) के HVAC contractors
> नोट: competitors के ज़्यादातर आँकड़े उनकी अपनी मार्केटिंग या affiliate review blogs से हैं।
> इन्हें दिशा समझने के लिए इस्तेमाल करें, guaranteed fact की तरह नहीं। Sources आख़िर में हैं।

---

## 1. मार्केट एक नज़र में

| बात | आँकड़ा | Source का भरोसा |
|---|---|---|
| US HVAC contractor industry का साइज़ | ~$159.4B (2026) | IBISWorld, मज़बूत |
| US में HVAC contractor businesses | ~120,000 | IBISWorld, मज़बूत |
| Home services में कितनी calls miss होती हैं | 14–27% (peak season में 25–40% तक बताया जाता है) | CallRail data (vendor ने quote किया), मध्यम |
| जिनकी call miss हुई, उनमें से कितने वापस call नहीं करते | ~78–85% | CallRail survey / vendors, मध्यम |
| एक missed call की क़ीमत | $200–$950 (repair); replacement job $3,000–$15,000 | Vendor estimates, कमज़ोर |
| गर्मी में after-hours calls | June में weekday after-hours calls 9.3% (October में 6.8%), सबसे ज़्यादा 5–9 PM | ServiceTitan का 2025 data, मज़बूत |
| Heat wave में call volume | normal से 20%+ ऊपर (vendors 3–4x तक बताते हैं) | KCTV news 2026 / vendors |

**हमारी sales story यही है:** HVAC वाले की टीम roof पर या basement में काम कर रही होती है, phone बजता
रहता है, और जो call miss हुई वो customer अगली कंपनी को call कर लेता है। गर्मी की heat wave और सर्दी
में "no heat" की emergency के वक़्त ही सबसे ज़्यादा calls miss होती हैं। हमारा AI हर call उठाता है,
emergency पहचानता है, job book करता है और owner को summary भेजता है।

---

## 2. Competitors — कौन क्या बेच रहा है और किस भाव

### 2a. HVAC/home-services वाले specialist (महँगे, बड़े contractors के लिए)

| Competitor | Price | Positioning | क्या ख़ास है | कमज़ोरी (हमारा मौका) |
|---|---|---|---|---|
| **Avoca AI** | Price public नहीं; अंदाज़न $1,000–$3,500/माह | बड़े ServiceTitan वाले operators (20+ CSRs, $10M+ revenue) | ServiceTitan certified app, CSR call coaching (हर call को 0–100 score), estimate follow-up, Brody Pennell case study: booking rate 70% → 90% | Free trial नहीं, onboarding 4–12 हफ़्ते, $3M से छोटे shop के लिए "over-engineered" |
| **Sameday AI** | $449/माह (500 min, 3 locations), $789/माह (1,000 min) | Mid-size home services | ServiceTitan, Housecall Pro, Jobber, FieldRoutes, Service Fusion में booking; SMS; win-back campaigns; "92% booking rate" का दावा | छोटे/solo contractor के लिए entry price बहुत ऊँचा |
| **ServiceTitan Virtual Agents** | Usage-based add-on, price public नहीं | सिर्फ़ ServiceTitan customers | Native, अलग integration की ज़रूरत नहीं | सिर्फ़ ServiceTitan के अंदर, छोटे contractors ServiceTitan इस्तेमाल ही नहीं करते |
| **Probook, Netic, Hatch** | "Contact for pricing" | Booking rate optimisation | — | Price छुपाते हैं, यानी demo-heavy और महँगे |

### 2b. सस्ते, सबके लिए वाले AI receptionists (horizontal)

| Competitor | Price | Model |
|---|---|---|
| **Dialzara** | $29 (60 min) · $99 (220) · $199 (500) · $349 (1,000) | Per minute, extra $0.48/min |
| **Rosie** | $49 (250 min) · $149 (1,000) · $299 (2,000) | Calendar booking सिर्फ़ $149 वाले plan से; English + Spanish |
| **Goodcall** | $79 (100 unique callers) · $129 · $299 | Per unique caller, per-minute charge नहीं |
| **NextPhone** | $199/माह से flat, free trial | Housecall Pro, Jobber, ServiceTitan integrations listed |
| **My AI Front Desk** | Free trial, credit card नहीं चाहिए | Self-serve |
| **Smith.ai** | AI: $97.50/50 calls के आसपास, extra ~$3–4.25/call; live human: ~$292+/माह | AI + इंसानी backup (hybrid) |

### 2c. पुराने इंसानी answering services (हमारा असली replacement target)

- HVAC के लिए human answering service: **$150–$450/माह**, या $0.85–$1.60 प्रति मिनट
- 24/7 emergency dispatch packages: **$200–$800+/माह**
- AnswerForce: $279/माह में 200 मिनट

### 2d. मार्केट में क्या बिक रहा है (pattern)

1. **"24/7 हर call उठाओ + job book करो"** हर किसी की headline है। ये ज़रूरी है, लेकिन इससे हम अलग नहीं दिखेंगे।
2. **Emergency triage** HVAC की सबसे बड़ी ज़रूरत है: gas smell, CO alarm, no heat, no AC में फ़र्क़ करना। Emergency हो तो on-call tech को transfer या text, और routine काम हो तो अगले दिन का slot।
3. **FSM integration** (ServiceTitan, Jobber, Housecall Pro) mid-market में deal-breaker है। छोटे contractors के लिए Google Calendar काफ़ी है।
4. **SMS text-back** (missed या abandoned call पर तुरंत text) लगभग हर HVAC vendor दे रहा है।
5. **Outbound**: maintenance/tune-up reminders, बिना बिके estimates का follow-up, पुराने customers को win-back। बड़े players इसी से upsell करते हैं।
6. **Spanish** support अमेरिका में बड़ा plus है (Rosie हर plan में दे रहा है)।
7. **Trust के सबूत**: "हमारे AI को अभी call करें" वाला live demo number, booking rate के आँकड़े, case studies, ROI calculator।
8. **Price का gap**: सस्ते tools ($29–$199) generic हैं और HVAC नहीं समझते, जबकि HVAC specialist $449 से $3,500 तक के हैं। **$150–$400 का HVAC-specialist slot लगभग ख़ाली है।** यहीं हमें बैठना है।

---

## 3. हमारा platform आज क्या कर सकता है (honest mapping)

वेबसाइट पर वही लिखना है जो product सच में करता है। ये mapping `README.md` से ली गई है:

| HVAC की ज़रूरत | Platform में आज | वेबसाइट पर कैसे लिखें |
|---|---|---|
| 24/7 call answering | ✅ Telnyx/Twilio + LiveKit | पूरा claim करें |
| Emergency triage + on-call tech को transfer | ✅ Prompt + "transfer to a person" tool. Platform rule में emergency → 911 पहले से है | Claim करें। Gas/CO के लिए script: "घर से बाहर निकलें, 911/gas company को call करें", फिर तुरंत transfer |
| Appointment booking | ✅ Google/Outlook calendar | "Books into your Google or Outlook calendar" |
| ServiceTitan / Jobber / Housecall Pro | ⚠️ Native नहीं। Custom HTTP functions, MCP और webhooks से बन सकता है | "Connects to your FSM via custom integration (Pro/Growth plan, we set it up)". "Native ServiceTitan app" मत लिखें |
| Call recording, transcript, AI summary | ✅ MP3, transcript, post-call analysis, custom fields | Claim करें |
| Webhooks (Zapier/Make/CRM में भेजना) | ✅ Signed webhooks | Claim करें |
| Website chat + click-to-call widget | ✅ एक `<script>` tag | Claim करें। ये differentiator है |
| Spanish / multilingual | ✅ 27 भाषाएँ + auto-detect | "English & Spanish" को headline feature बनाएँ |
| Outbound calls (reminders, estimate follow-up) | ⚠️ एक-एक call, dashboard या API से; bulk campaigns अभी नहीं | "Outbound follow-up calls" लिखें, "mass campaigns" नहीं |
| SMS text-back / confirmations | ❌ अभी नहीं बना | "Coming soon" लिखें, या launch से पहले बनाएँ (**सबसे ज़रूरी gap**) |
| Online payment / self-serve signup billing | ❌ Stripe नहीं है | MVP में "Book a demo" / "Start pilot" flow रखें, invoice manually |
| White label / agency | ✅ Sub-accounts + custom domain | HVAC और Limo, दोनों niche sites इसी से अपना-अपना branded dashboard दे सकती हैं |

**Launch से पहले बनाने की सलाह (priority के क्रम में):**
1. **Missed-call SMS text-back + booking confirmation SMS** (Telnyx/Twilio messaging)। हर competitor के पास है।
2. **HVAC agent template** (Admin → Templates में): emergency keywords, on-call transfer, service area check, tune-up booking, Spanish greeting।
3. **Website के लिए demo phone number** जिस पर HVAC demo agent चले, और homepage पर browser "Talk to our AI" button (हमारे पास पहले से browser test call और widget मौजूद है)।
4. Jobber/Housecall Pro का एक ready custom-function recipe। ServiceTitan बाद में।

---

## 4. Pricing की सलाह (MVP)

Positioning: **"Avoca/Sameday जैसा HVAC-specialist AI, आधी से कम क़ीमत पर, एक हफ़्ते में live, कोई contract नहीं।"**

| Plan | Price/माह | Minutes | किसके लिए | क्या मिलेगा |
|---|---|---|---|---|
| **Starter** | $149 | 300 | 1–3 trucks, owner-operator | 24/7 answering, emergency triage + transfer, calendar booking, call summaries by email/webhook, English + Spanish |
| **Pro** ⭐ (सबसे ज़्यादा बेचें) | $297 | 800 | 4–15 trucks | Starter + website chat/call widget, outbound follow-up calls (tune-up reminders, estimate follow-up), custom fields, priority support, SMS text-back (जब बन जाए) |
| **Growth** | $497 | 1,800 | Multi-location, 15+ trucks | Pro + FSM integration (Jobber/HCP/ServiceTitan via custom function, setup हम करेंगे), multiple numbers/locations, monthly call review |

- **Extra minutes:** $0.20–$0.25/min. Competitors overage से ग्राहक को डराते हैं, तो हम साफ़ लिखें: "No surprise bills, we alert you at 80%."
- **Setup:** Founding customers के लिए free "done-for-you setup", बाद में $299 one-time।
- **Launch offer (MVP को boost करने के लिए):** पहले 20 HVAC clients के लिए "Founding Contractor" offer: **14 दिन का free pilot, फिर ज़िंदगी भर 30% off**, बदले में testimonial/case study। Case studies हमारी सबसे बड़ी कमी है (कोई social proof नहीं) और यही offer उसे भरेगा।
- **Margin check (अंदाज़ा, verify करना है):** Deepgram + LLM + Cartesia + Telnyx मिलाकर लगभग $0.06–$0.12/min बैठता है। 800 min पर ~$50–$100 cost, $297 पर अच्छा margin। Admin → Settings के provider rates और call cost से असली आँकड़ा निकाल लें।
- **Annual:** 2 महीने free (≈17% off)।

Price को human answering service ($200–$800) से compare करके दिखाएँ, AI tools से नहीं।

---

## 5. वेबसाइट का साइटमैप (HVAC)

**Domain की सलाह:** HVAC के लिए अलग niche brand/domain (जैसे `[brand]hvac.ai` या `[brand].ai/hvac`)। Contractor को
"HVAC के लिए बना" brand ज़्यादा भरोसेमंद लगता है, और Limo की messaging बिलकुल अलग होगी। दोनों sites
एक ही platform पर चलेंगी (white-label custom domain feature से)। अगर SEO authority एक जगह रखनी है तो
एक main domain पर `/hvac` और `/limo` folders रखें। ये फ़ैसला आपका है।

### Phase 1: Launch (9 main pages + legal)

```
/                         Home
├── /how-it-works         कैसे काम करता है (3 steps + setup timeline)
├── /features             सारे features (एक page पर sections, नीचे list)
├── /demo                 Live demo: "Call our AI now" number + browser में बात करें + sample recordings
├── /pricing              3 plans + ROI / missed-call calculator + pricing FAQ
├── /integrations         Google/Outlook Calendar, Jobber, Housecall Pro, ServiceTitan (custom), Zapier/webhooks
├── /about                हम कौन हैं, क्यों HVAC
├── /faq                  Objections का जवाब (robot लगेगा? emergency? Spanish? contract?)
├── /contact  (/book-demo) Demo booking form + calendar embed
├── /signup → app         Pilot शुरू करें (मौजूदा app का /signup या onboarding)
└── Legal
    ├── /privacy
    ├── /terms
    └── /call-recording-and-ai-disclosure  (US call recording consent states, AI disclosure)
```

### Phase 2: Launch के 1–3 महीने बाद (SEO + trust)

```
├── /case-studies                 Founding customers की stories (booking rate, revenue recovered)
│   └── /case-studies/[company]
├── /use-cases                    या /solutions
│   ├── /after-hours-answering
│   ├── /emergency-dispatch
│   ├── /overflow-peak-season     (heat wave / cold snap)
│   └── /maintenance-reminders
├── /compare                      "Avoca alternative", "Sameday alternative", "vs human answering service"
│   └── /compare/[competitor]
├── /tools/missed-call-calculator  Free tool (SEO + lead magnet)
├── /blog                         "HVAC answering service cost", "how to handle summer call surges"...
├── /partners                     Agencies के लिए white-label/reseller program
└── /es                           Spanish landing page (Spanish बोलने वाले contractors)
```

### Navigation

- **Header:** Features · How it works · Pricing · Demo · Integrations · **[Hear it live: (xxx) xxx-xxxx]** · **[Book a demo]** (button)
- **Footer:** सारे pages + legal + phone + email + "Built for HVAC. Also for: Limousine (link)"

---

## 6. Page-by-page content (क्या लिखना है)

वेबसाइट की copy English में होगी (US market)। नीचे हर section का draft दिया है।

### 6.1 Home `/`

1. **Hero**
   - H1: **"Never miss another HVAC call. Your AI dispatcher answers 24/7, triages emergencies and books jobs."**
   - Sub: "Built for heating & cooling contractors. Live in 7 days. No contracts."
   - CTAs: `[Hear it live: call (xxx) xxx-xxxx]` `[Talk to it in your browser]` `[Book a demo]`
   - Trust line: "English & Spanish · Works with Google Calendar, Jobber, Housecall Pro"
2. **Problem (आँकड़ों के साथ):** "1 in 4 calls goes unanswered in peak season. 8 in 10 of those callers never call back. They call your competitor." (Sources के साथ footnote दें।)
3. **3 बड़े outcomes:** 24/7 answering · Emergency triage & on-call transfer · Jobs booked straight into your calendar
4. **Live demo block:** audio player पर 3 sample calls: (a) AC बंद है, 9 PM, booking; (b) gas की बदबू → safety script + on-call transfer; (c) Spanish में tune-up booking
5. **How it works (3 steps):** Forward your number → We train it on your services, area & prices → It answers, books and sends you the summary
6. **Feature grid** (`/features` पर link)
7. **ROI calculator का छोटा version:** calls/day × miss rate × avg ticket = "You're losing ~$X/month"
8. **Pricing teaser:** "Plans from $149/mo, less than a part-time CSR" → `/pricing`
9. **Comparison table:** Voicemail vs Human answering service vs Our AI (price, 24/7, booking, Spanish, consistency)
10. **Founding Contractor offer banner:** "14-day free pilot + 30% off for life, first 20 contractors"
11. **FAQ** (5–6 सवाल) + final CTA

### 6.2 How it works `/how-it-works`
Day 1: kickoff call (services, service area, pricing rules, emergency rules, on-call number) → Day 2–5: हम agent बनाते और test करते हैं (आपके website से knowledge base) → Day 6: आप test calls करते हैं → Day 7: call forwarding चालू (सिर्फ़ after-hours / overflow / पूरा 24/7, आपकी मर्ज़ी)। Diagram: caller → AI → emergency? → on-call tech / booking → calendar + summary।

### 6.3 Features `/features`
हर feature का एक section, HVAC की भाषा में:
- **24/7 answering**: nights, weekends, holidays, heat waves
- **Emergency triage**: gas smell / CO alarm / no heat / no AC / water leak, आपके rules के हिसाब से; on-call tech को live transfer
- **Job booking**: Google/Outlook calendar में, service area और job type check करके
- **Overflow mode**: आपकी टीम busy हो तभी AI उठाए
- **Call summaries & recordings**: हर call का transcript, AI summary, customer details, urgency
- **Outbound follow-ups**: tune-up reminders, estimate follow-up, missed-call callback
- **Website chat & click-to-call widget**: एक line का code
- **English & Spanish** (और 25 भाषाएँ)
- **Your data, your way**: webhooks → CRM/Zapier/Google Sheets
- **Guardrails**: price या commitments पर सिर्फ़ आपके दिए rules, बात न बने तो इंसान को transfer
- **SMS text-back**: "Coming soon" (या launch से पहले बना लें)

### 6.4 Demo `/demo`
बड़ा phone number + "Talk in browser" button (मौजूदा widget से) + 3 sample recordings + "Try saying: 'My AC stopped working and it's 95 degrees'"। नीचे Book-a-demo form। **ये site का सबसे ज़्यादा convert करने वाला page होगा।** Competitors में ElevenLabs और My AI Front Desk यही करते हैं।

### 6.5 Pricing `/pricing`
3 plan cards (section 4 वाले) + annual toggle + "What counts as a minute" + overage policy + full **Missed-call ROI calculator** (inputs: calls/day, % missed, avg ticket, close rate) + comparison: "vs human answering service $200–$800/mo" + pricing FAQ + Founding offer।

### 6.6 Integrations `/integrations`
Logos grid, हर logo पर ईमानदार label: "Native" (Google Calendar, Outlook, Telnyx, Twilio, webhooks) / "Custom setup by our team" (Jobber, Housecall Pro, ServiceTitan, FieldEdge) / "Coming soon"। "Your FSM isn't listed? We connect via API." CTA।

### 6.7 About `/about`
Story: "हमने देखा कि contractors roof पर होते हैं और phone बजता रहता है..." Team, mission, contact. छोटा रखें।

### 6.8 FAQ `/faq`
- Will callers know it's AI? (AI disclosure setting है, हम इसके बारे में honest रहें)
- What happens in an emergency like a gas leak?
- Can it quote prices? (सिर्फ़ आपके दिए rules से, जैसे "diagnostic fee $89")
- Does it speak Spanish?
- Can I keep my phone number? (हाँ, call forwarding से)
- Contract? (नहीं, month-to-month)
- What if it can't answer? (आपके number पर transfer या message ले लेता है)
- Is my call data secure? Recording consent?

### 6.9 Contact / Book a demo `/contact`
Short form: Name, Company, Phone, # of trucks, FSM software (dropdown), "Biggest call problem" + calendar embed। Form submit पर हमारा अपना AI agent 60 सेकंड में lead को call करे (outbound API से)। ये अपने आप में सबसे अच्छा demo है।

---

## 7. MVP को boost करने वाली चीज़ें (checklist)

- [ ] Demo phone number + HVAC demo agent (हर page के header में)
- [ ] Browser "Talk to AI" button (मौजूदा widget)
- [ ] Speed-to-lead: demo form भरते ही हमारा AI call करे
- [ ] 3 sample call recordings (AC emergency, gas smell, Spanish booking)
- [ ] ROI calculator
- [ ] Founding Contractor offer (14-दिन pilot + 30% lifetime off, बदले में case study)
- [ ] SMS text-back बनाना (सबसे बड़ा product gap)
- [ ] HVAC template: emergency keywords, on-call transfer, service-area check
- [ ] Legal: privacy, terms, call recording/AI disclosure
- [ ] SEO basics: हर page का title/meta, schema (`SoftwareApplication`, `FAQPage`), Google Business Profile
- [ ] Targeted keywords (volume tool जैसे Google Keyword Planner या Semrush से verify करें): "HVAC answering service", "AI receptionist for HVAC", "HVAC after hours answering service", "HVAC call answering service", "Avoca alternative"

---

## 8. अगला कदम

1. Pricing और domain पर फ़ैसला
2. Phase 1 के 9 pages बनाना (Next.js में, इसी repo में `site/` folder में या अलग repo में)
3. इसी format में Limousine का research + sitemap

---

## Sources

- [IBISWorld: Heating & Air-Conditioning Contractors in the US](https://www.ibisworld.com/united-states/market-research-reports/heating-air-conditioning-contractors-industry/)
- [ServiceTitan: Summer after-hours call spike](https://www.servicetitan.com/toolbox/state-of-the-trades/trends/hvac-summer-after-hours-call-spike)
- [ServiceTitan: AI Virtual Agents in HVAC](https://www.servicetitan.com/blog/ai-virtual-agents-in-hvac)
- [KCTV5: Heat wave pushes HVAC crews to the limit (2026)](https://www.kctv5.com/2026/09/02/heat-wave-pushes-metro-ac-units-hvac-crews-limit/)
- [Thoughtly: AI agents for HVAC lead capture](https://thoughtly.com/blog/ai-agents-hvac-contractors-lead-capture-dispatch)
- [Signpost: How much business contractors lose from missed calls](https://www.signpost.com/blog/how-much-business-do-contractors-lose-from-missed-calls/)
- [FieldCamp: After-hours call statistics](https://fieldcamp.ai/ai-receptionist/after-hours-call-statistics/)
- [Twig: HVAC call answering AI](https://www.twig.so/blog/hvac-call-answering-ai)
- [getmacha: Avoca AI pricing review](https://www.getmacha.com/blog/avoca-ai-complete-guide)
- [FieldCamp: Avoca AI review](https://fieldcamp.ai/reviews/avoca-ai/)
- [contractortoolstack: Avoca AI review](https://contractortoolstack.com/software/avoca-ai/)
- [Case study: Brody Pennell × Avoca](https://www.casestudies.com/company/avoca/case-study/brody-pennell-boosts-booking-rate-from-70-to-90-with-avoca)
- [Sameday AI: Best AI receptionist for home services](https://sameday.ai/best-ai-receptionist-for-home-services)
- [Sameday AI: HVAC](https://sameday.ai/industries/hvac)
- [Stork: Sameday AI review](https://www.stork.ai/en/sameday-ai)
- [Golmtech: Sameday AI review](https://golmtech.solutions/blog/sameday-ai-answering-service-review/)
- [The Boss Magazine: Best AI receptionists for HVAC 2026](https://thebossmagazine.com/post/best-ai-receptionists-hvac-companies-2026/)
- [Futuro: Best AI receptionist for HVAC](https://www.futurocorp.com/buyers-guides/best-ai-receptionist-for-hvac-companies)
- [NextPhone: Best AI receptionist for HVAC](https://www.getnextphone.com/blog/best-virtual-receptionist-for-hvac)
- [Capterra: NextPhone](https://www.capterra.co.uk/software/1087966/NextPhone)
- [Kabsai Labs: AI receptionist cost, 7 providers](https://www.kabsailabs.com/blog/ai-receptionist-cost)
- [LeadFriendly: AI receptionist pricing index 2026](https://www.leadfriendly.com/guides/ai-receptionist-pricing-index-2026)
- [Superdupr: AI receptionist cost 2026](https://superdupr.com/blog/how-much-does-an-ai-receptionist-cost)
- [Retell AI: Best answering service for HVAC](https://www.retellai.com/blog/best-answering-service-for-hvac-company)
- [Dialzara: Best HVAC answering services](https://dialzara.com/blog/best-hvac-answering-services)
- [My AI Front Desk: HVAC answering service cost](https://www.myaifrontdesk.com/how-much-does-a-phone-answering-service-cost/hvac)
- [Lunacal: AI receptionists for HVAC tested](https://lunacal.ai/blogs/ai-receptionist-for-HVAC)
- [Marlie: HVAC answering service](https://www.marlie.ai/industries/hvac-technicians-answering-service)
- [ElevenLabs: HVAC AI answering service](https://elevenlabs.io/ai-answering-service/hvac)
- [Jobber: HVAC industry trends](https://getjobber.com/academy/hvac/hvac-industry-trends)
