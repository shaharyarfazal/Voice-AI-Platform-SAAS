# HVAC Voice AI Agent: Market Research, Pricing and Website Sitemap

> Researched: October 2026 · Target market: HVAC contractors in the United States
> Note: most competitor figures come from their own marketing or from affiliate review blogs.
> Use them to see the direction of the market, not as guaranteed facts. Sources are at the end.

---

## 1. The market at a glance

| Point | Figure | Source reliability |
|---|---|---|
| US HVAC contractor industry size | ~$159.4B (2026) | IBISWorld, strong |
| HVAC contractor businesses in the US | ~120,000 | IBISWorld, strong |
| Share of home-services calls that go unanswered | 14–27% (vendors cite 25–40% in peak season) | CallRail data quoted by vendors, medium |
| Callers who don't call back after a missed call | ~78–85% | CallRail survey / vendors, medium |
| Value of one missed call | $200–$950 for a repair; $3,000–$15,000 for a replacement job | Vendor estimates, weak |
| After-hours calls in summer | Weekday after-hours calls reach 9.3% of inbound in June (6.8% in October); busiest 5–9 PM | ServiceTitan 2025 data, strong |
| Call volume in a heat wave | 20%+ above normal (vendors claim 3–4x) | KCTV news 2026 / vendors |

**Our sales story:** the HVAC team is on a roof or in a basement, the phone keeps ringing, and every
missed call goes to the next company on Google. Calls are missed most in exactly the moments that
matter: summer heat waves and winter "no heat" emergencies. Our AI answers every call, recognises
emergencies, books the job and sends the owner a summary.

---

## 2. Competitors: what they sell and at what price

### 2a. HVAC / home-services specialists (expensive, aimed at larger contractors)

| Competitor | Price | Positioning | Strengths | Weakness (our opening) |
|---|---|---|---|---|
| **Avoca AI** | Not published; estimated $1,000–$3,500/mo | Large ServiceTitan operators (20+ CSRs, $10M+ revenue) | Certified ServiceTitan app, CSR call coaching (every call scored 0–100), estimate follow-up; Brody Pennell case study: booking rate 70% → 90% | No free trial, 4–12 week onboarding, "over-engineered" for shops under ~$3M |
| **Sameday AI** | $449/mo (500 min, 3 locations), $789/mo (1,000 min) | Mid-size home services | Books into ServiceTitan, Housecall Pro, Jobber, FieldRoutes, Service Fusion; SMS; win-back campaigns; claims a 92% booking rate | Entry price too high for small or solo contractors |
| **ServiceTitan Virtual Agents** | Usage-based add-on, price not published | ServiceTitan customers only | Native, no separate integration | Only inside ServiceTitan; most small contractors don't use ServiceTitan |
| **Probook, Netic, Hatch** | "Contact for pricing" | Booking-rate optimisation | — | Hidden pricing means demo-heavy, expensive sales |

### 2b. Cheap general-purpose AI receptionists

| Competitor | Price | Model |
|---|---|---|
| **Dialzara** | $29 (60 min) · $99 (220) · $199 (500) · $349 (1,000) | Per minute, $0.48/min overage |
| **Rosie** | $49 (250 min) · $149 (1,000) · $299 (2,000) | Calendar booking only from the $149 plan; English + Spanish |
| **Goodcall** | $79 (100 unique callers) · $129 · $299 | Per unique caller, no per-minute charge |
| **NextPhone** | From $199/mo flat, free trial | Lists Housecall Pro, Jobber and ServiceTitan integrations |
| **My AI Front Desk** | Free trial, no credit card | Self-serve |
| **Smith.ai** | AI: around $97.50 for 50 calls, ~$3–4.25 per extra call; live human: ~$292+/mo | AI plus human backup (hybrid) |

### 2c. Traditional human answering services (our real replacement target)

- Human answering service for HVAC: **$150–$450/mo**, or $0.85–$1.60 per minute
- 24/7 emergency dispatch packages: **$200–$800+/mo**
- AnswerForce: $279/mo for 200 minutes

### 2d. What is selling (patterns)

1. **"Answer every call 24/7 and book the job"** is everyone's headline. It is required, but it won't set us apart.
2. **Emergency triage** is HVAC's biggest need: telling a gas smell or CO alarm apart from no heat or no AC. Emergencies go to the on-call tech by transfer or text; routine work gets the next available slot.
3. **FSM integration** (ServiceTitan, Jobber, Housecall Pro) is a deal-breaker in the mid-market. For small contractors, Google Calendar is enough.
4. **SMS text-back** (an instant text after a missed or abandoned call) is offered by almost every HVAC vendor.
5. **Outbound:** maintenance/tune-up reminders, follow-up on unsold estimates, win-back of past customers. Larger players upsell with this.
6. **Spanish** support is a big plus in the US (Rosie includes it on every plan).
7. **Proof of trust:** a "call our AI right now" live demo number, booking-rate figures, case studies, an ROI calculator.
8. **The price gap:** cheap tools ($29–$199) are generic and don't understand HVAC, while HVAC specialists cost $449–$3,500. **The $150–$400 HVAC-specialist slot is almost empty.** That is where we should sit.

---

## 3. What our platform can do today (honest mapping)

The website must only claim what the product really does. This mapping is taken from `README.md`:

| HVAC need | Platform today | How to word it on the website |
|---|---|---|
| 24/7 call answering | ✅ Telnyx/Twilio + LiveKit | Claim fully |
| Emergency triage + transfer to on-call tech | ✅ Prompt + "transfer to a person" tool; the platform-wide emergency → 911 rule already exists | Claim it. Gas/CO script: "leave the house, call 911 or the gas company", then transfer immediately |
| Appointment booking | ✅ Google/Outlook calendar | "Books into your Google or Outlook calendar" |
| ServiceTitan / Jobber / Housecall Pro | ⚠️ Not native. Can be built with custom HTTP functions, MCP and webhooks | "Connects to your FSM through a custom integration we set up (Pro/Growth)". Do not say "native ServiceTitan app" |
| Call recording, transcript, AI summary | ✅ MP3, transcript, post-call analysis, custom fields | Claim it |
| Webhooks (to Zapier/Make/CRM) | ✅ Signed webhooks | Claim it |
| Website chat + click-to-call widget | ✅ One `<script>` tag | Claim it; it's a differentiator |
| Spanish / multilingual | ✅ 27 languages + auto-detect | Make "English & Spanish" a headline feature |
| Outbound calls (reminders, estimate follow-up) | ⚠️ One call at a time from the dashboard or API; no bulk campaigns yet | Say "outbound follow-up calls", not "mass campaigns" |
| SMS text-back / confirmations | ❌ Not built | Say "coming soon", or build it before launch (**the most important gap**) |
| Online payment / self-serve billing | ❌ No Stripe | Use a "Book a demo" / "Start a pilot" flow for the MVP and invoice manually |
| White label / agency | ✅ Sub-accounts + custom domain | The HVAC and Limo niche sites can each give clients their own branded dashboard with this |

**Recommended to build before launch (in priority order):**
1. **Missed-call SMS text-back + booking confirmation SMS** (Telnyx/Twilio messaging). Every competitor has it.
2. **HVAC agent template** (Admin → Templates): emergency keywords, on-call transfer, service-area check, tune-up booking, Spanish greeting.
3. **A demo phone number for the website** running an HVAC demo agent, plus a "Talk to our AI" browser button on the homepage (we already have browser test calls and the widget).
4. A ready custom-function recipe for Jobber / Housecall Pro. ServiceTitan later.

---

## 4. Pricing recommendation (MVP)

Positioning: **"A specialist HVAC AI like Avoca or Sameday, for less than half the price, live in a week, no contract."**

| Plan | Price/mo | Minutes | For | Includes |
|---|---|---|---|---|
| **Starter** | $149 | 300 | 1–3 trucks, owner-operators | 24/7 answering, emergency triage + transfer, calendar booking, call summaries by email/webhook, English + Spanish |
| **Pro** ⭐ (lead with this) | $297 | 800 | 4–15 trucks | Starter + website chat/call widget, outbound follow-up calls (tune-up reminders, estimate follow-up), custom fields, priority support, SMS text-back (once built) |
| **Growth** | $497 | 1,800 | Multi-location, 15+ trucks | Pro + FSM integration (Jobber/HCP/ServiceTitan via custom function, set up by us), multiple numbers/locations, monthly call review |

- **Extra minutes:** $0.20–$0.25/min. Competitors scare buyers with overage, so say it plainly: "No surprise bills, we alert you at 80%."
- **Setup:** free "done-for-you setup" for founding customers, then $299 one-time.
- **Launch offer (to boost the MVP):** a "Founding Contractor" offer for the first 20 HVAC clients: **14-day free pilot, then 30% off for life**, in exchange for a testimonial or case study. Our biggest weakness is having no social proof, and this offer fixes that.
- **Margin check (estimate, needs verifying):** Deepgram + LLM + Cartesia + Telnyx comes to roughly $0.06–$0.12/min. At 800 min that's ~$50–$100 of cost on a $297 plan, a healthy margin. Get the real number from the provider rates in Admin → Settings and the per-call cost.
- **Annual:** 2 months free (≈17% off).

Compare our price against human answering services ($200–$800), not against AI tools.

---

## 5. Website sitemap (HVAC)

**Domain recommendation:** a separate niche brand/domain for HVAC (e.g. `[brand]hvac.ai` or `[brand].ai/hvac`).
A brand "built for HVAC" earns more trust from contractors, and the Limo messaging will be completely
different. Both sites run on the same platform (through the white-label custom-domain feature). If
you'd rather keep SEO authority in one place, use one main domain with `/hvac` and `/limo` folders.
This is your decision.

### Phase 1: Launch (9 main pages + legal)

```
/                         Home
├── /how-it-works         How it works (3 steps + setup timeline)
├── /features             All features (one page, sections listed below)
├── /demo                 Live demo: "Call our AI now" number + talk in the browser + sample recordings
├── /pricing              3 plans + ROI / missed-call calculator + pricing FAQ
├── /integrations         Google/Outlook Calendar, Jobber, Housecall Pro, ServiceTitan (custom), Zapier/webhooks
├── /about                Who we are, why HVAC
├── /faq                  Answers to objections (will it sound robotic? emergencies? Spanish? contract?)
├── /contact  (/book-demo) Demo booking form + calendar embed
├── /signup → app         Start a pilot (the existing app's /signup or onboarding)
└── Legal
    ├── /privacy
    ├── /terms
    └── /call-recording-and-ai-disclosure  (US call-recording consent states, AI disclosure)
```

### Phase 2: 1–3 months after launch (SEO + trust)

```
├── /case-studies                 Founding customers' stories (booking rate, revenue recovered)
│   └── /case-studies/[company]
├── /use-cases                    (or /solutions)
│   ├── /after-hours-answering
│   ├── /emergency-dispatch
│   ├── /overflow-peak-season     (heat wave / cold snap)
│   └── /maintenance-reminders
├── /compare                      "Avoca alternative", "Sameday alternative", "vs human answering service"
│   └── /compare/[competitor]
├── /tools/missed-call-calculator  Free tool (SEO + lead magnet)
├── /blog                         "HVAC answering service cost", "how to handle summer call surges"...
├── /partners                     White-label / reseller program for agencies
└── /es                           Spanish landing page (for Spanish-speaking contractors)
```

### Navigation

- **Header:** Features · How it works · Pricing · Demo · Integrations · **[Hear it live: (xxx) xxx-xxxx]** · **[Book a demo]** (button)
- **Footer:** all pages + legal + phone + email + "Built for HVAC. Also for: Limousine (link)"

---

## 6. Page-by-page content

### 6.1 Home `/`

1. **Hero**
   - H1: **"Never miss another HVAC call. Your AI dispatcher answers 24/7, triages emergencies and books jobs."**
   - Sub: "Built for heating & cooling contractors. Live in 7 days. No contracts."
   - CTAs: `[Hear it live: call (xxx) xxx-xxxx]` `[Talk to it in your browser]` `[Book a demo]`
   - Trust line: "English & Spanish · Works with Google Calendar, Jobber, Housecall Pro"
2. **Problem (with numbers):** "1 in 4 calls goes unanswered in peak season. 8 in 10 of those callers never call back. They call your competitor." (Footnote the sources.)
3. **3 big outcomes:** 24/7 answering · Emergency triage & on-call transfer · Jobs booked straight into your calendar
4. **Live demo block:** audio player with 3 sample calls: (a) AC is out at 9 PM, job booked; (b) gas smell → safety script + on-call transfer; (c) tune-up booked in Spanish
5. **How it works (3 steps):** Forward your number → We train it on your services, area & prices → It answers, books and sends you the summary
6. **Feature grid** (links to `/features`)
7. **Mini ROI calculator:** calls/day × miss rate × average ticket = "You're losing ~$X/month"
8. **Pricing teaser:** "Plans from $149/mo, less than a part-time CSR" → `/pricing`
9. **Comparison table:** Voicemail vs human answering service vs our AI (price, 24/7, booking, Spanish, consistency)
10. **Founding Contractor offer banner:** "14-day free pilot + 30% off for life, first 20 contractors"
11. **FAQ** (5–6 questions) + final CTA

### 6.2 How it works `/how-it-works`
Day 1: kickoff call (services, service area, pricing rules, emergency rules, on-call number) → Days 2–5: we build and test the agent (knowledge base from your website) → Day 6: you make test calls → Day 7: call forwarding goes live (after-hours only, overflow, or full 24/7, your choice). Diagram: caller → AI → emergency? → on-call tech / booking → calendar + summary.

### 6.3 Features `/features`
One section per feature, in HVAC language:
- **24/7 answering:** nights, weekends, holidays, heat waves
- **Emergency triage:** gas smell / CO alarm / no heat / no AC / water leak, following your rules; live transfer to the on-call tech
- **Job booking:** into Google/Outlook calendar, after checking service area and job type
- **Overflow mode:** the AI only answers when your team is busy
- **Call summaries & recordings:** transcript, AI summary, customer details and urgency for every call
- **Outbound follow-ups:** tune-up reminders, estimate follow-up, missed-call callback
- **Website chat & click-to-call widget:** one line of code
- **English & Spanish** (plus 25 more languages)
- **Your data, your way:** webhooks → CRM / Zapier / Google Sheets
- **Guardrails:** prices and commitments only from the rules you give it; hands off to a person when it can't help
- **SMS text-back:** "coming soon" (or build it before launch)

### 6.4 Demo `/demo`
Large phone number + "Talk in your browser" button (using the existing widget) + 3 sample recordings + "Try saying: 'My AC stopped working and it's 95 degrees'". Book-a-demo form below. **This will be the highest-converting page on the site.** ElevenLabs and My AI Front Desk do the same.

### 6.5 Pricing `/pricing`
3 plan cards (from section 4) + annual toggle + "What counts as a minute" + overage policy + full **missed-call ROI calculator** (inputs: calls/day, % missed, average ticket, close rate) + comparison: "vs human answering service at $200–$800/mo" + pricing FAQ + founding offer.

### 6.6 Integrations `/integrations`
Logo grid with an honest label on each: "Native" (Google Calendar, Outlook, Telnyx, Twilio, webhooks) / "Custom setup by our team" (Jobber, Housecall Pro, ServiceTitan, FieldEdge) / "Coming soon". CTA: "Your FSM isn't listed? We connect via API."

### 6.7 About `/about`
The story: "We saw contractors up on roofs while the phone kept ringing..." Team, mission, contact. Keep it short.

### 6.8 FAQ `/faq`
- Will callers know it's AI? (There's an AI disclosure setting; be honest about it.)
- What happens in an emergency like a gas leak?
- Can it quote prices? (Only from rules you give it, e.g. "diagnostic fee $89")
- Does it speak Spanish?
- Can I keep my phone number? (Yes, through call forwarding)
- Is there a contract? (No, month-to-month)
- What if it can't answer a question? (It transfers to your number or takes a message)
- Is my call data secure? What about recording consent?

### 6.9 Contact / Book a demo `/contact`
Short form: name, company, phone, number of trucks, FSM software (dropdown), "biggest call problem" + calendar embed. When the form is submitted, our own AI agent calls the lead within 60 seconds (through the outbound API). That call is the best demo we can give.

---

## 7. MVP launch checklist

- [ ] Demo phone number + HVAC demo agent (in the header of every page)
- [ ] Browser "Talk to AI" button (existing widget)
- [ ] Speed-to-lead: our AI calls the lead as soon as the demo form is submitted
- [ ] 3 sample call recordings (AC emergency, gas smell, Spanish booking)
- [ ] ROI calculator
- [ ] Founding Contractor offer (14-day pilot + 30% lifetime discount in exchange for a case study)
- [ ] Build SMS text-back (biggest product gap)
- [ ] HVAC template: emergency keywords, on-call transfer, service-area check
- [ ] Legal: privacy, terms, call recording / AI disclosure
- [ ] SEO basics: title/meta on every page, schema (`SoftwareApplication`, `FAQPage`), Google Business Profile
- [ ] Target keywords (verify volumes in Google Keyword Planner or Semrush): "HVAC answering service", "AI receptionist for HVAC", "HVAC after hours answering service", "HVAC call answering service", "Avoca alternative"

---

## 8. Next steps

1. Decide on pricing and domain
2. Build the 9 Phase 1 pages (Next.js, in a `site/` folder in this repo or a separate repo)
3. Do the same research and sitemap for Limousine

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
