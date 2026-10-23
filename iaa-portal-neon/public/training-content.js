/* Iceland Aero Agents – Staff Portal
   Training content: Operations Officer SOP Manual v1.1.
   Copied unchanged from the IAA Ops Training page (23 Oct 2026).
   To change a lesson or question, edit it here and upload the file.
   Quiz answers: "a" is the position of the correct option in "o",
   counting from 0. */

window.TRAINING = {
  manual: "1.1",
  passMark: 0.8,
  modules: [
{
  id: "m1", code: "P1", title: "Station Familiarisation", part: "Part 1 · Sections 1–6",
  summary: "Standard ramp rules at all three stations, CIQ sequencing, and what is different at BIKF, BIRK and BIAR.",
  lesson: [
    { h: "Standard at every station", html: `
      <ul>
        <li>Marshal aircraft in and out, place chocks as soon as the aircraft stops, and secure it (extra tie-downs in high wind).</li>
        <li>Park <b>nose into wind</b> wherever possible. Consider the expected departure wind if the aircraft is staying a while. If in doubt, ask the captain.</li>
      </ul>` },
    { h: "CIQ — no contact before clearance", key: true, html: `
      <p>Until CIQ has cleared (or Customs has explicitly approved): <b>no fuelling, no services, no third-party transport, no bags to any third party.</b> IAA staff may still meet, greet and assist crew and passengers.</p>
      <p>At BIKF, Customs rarely attends, so Border Police clearance is normally the gating step. If unsure whether CIQ has cleared, check with the office or duty manager.</p>` },
    { h: "Border Police notification", html: `
      <div class="tbl"><table>
        <tr><th>Movement</th><th>Send details / GENDEC</th><th>On the ground</th></tr>
        <tr><td>Arrival from Schengen</td><td>≥ 1 h before departure from abroad</td><td>No border control (random checks)</td></tr>
        <tr><td>Arrival from third country</td><td>≥ 1 h before departure from abroad</td><td>Direct everyone to border control immediately</td></tr>
        <tr><td>Departure to Schengen</td><td>No later than 1 h before departure</td><td>No border control (random checks)</td></tr>
        <tr><td>Departure to third country</td><td>No later than 1 h before departure</td><td>Direct everyone to border control before boarding</td></tr>
      </table></div>
      <p>Nationality does not exempt anyone. Send as soon as details are available — 1 hour is the minimum. Each station has its own Border Police address (Section 23.6). The automatic evening drafts (Section 9.9) do not replace these timings.</p>` },
    { h: "BIKF — Keflavík", html: `
      <ul>
        <li>Cat A and B: dotted yellow line. Cat C and larger: middle solid line and a <b>pushback</b> — except stands <b>220 and 221</b>.</li>
        <li>Enter every aircraft in <b>Veovo</b>; <b>APOC</b> assigns the stand. Never assume a stand.</li>
        <li>Permanent DMA (dirty areas): our main office, Border Police, our storage behind the FBO, stands 101–108. A temporary DMA can be requested through APOC.</li>
        <li>Military aircraft with dangerous goods go to the <b>West Apron</b> — call <span class="mono">693 5912</span> in good time to open the gate.</li>
      </ul>` },
    { h: "BIRK — Reykjavík Domestic", html: `
      <ul>
        <li><b>Cones</b> at nose, tail and wingtips of every parked aircraft, in addition to chocks.</li>
        <li><b>Apron 1 Center</b>: APU running, 20-minute APU limit. <b>Apron 1 North</b>: non-APU and long-term parking, 0-minute APU limit. Long-term aircraft are towed from Center to North.</li>
        <li>Avgas aircraft may park at the pump, but fuelling waits for CIQ if required. Jet A-1 is delivered D2A by Skeljungur.</li>
      </ul>` },
    { h: "BIAR — Akureyri", html: `
      <ul>
        <li>Runs as a variant of BIRK: cones and chocks, Avgas pump, Jet A-1 D2A, full CIQ rule.</li>
        <li>Parking is flexible — confirm positions with the duty manager on site. No APU restriction.</li>
      </ul>` },
  ],
  quiz: [
    { q: "An aircraft has arrived from the USA and Border Police have not attended yet. Which of these is allowed?", o: ["Start fuelling so the turn stays on time", "Meet and greet the crew and passengers", "Hand the bags to the waiting taxi driver", "Let the caterer board the aircraft"], a: 1, e: "Only IAA staff may meet, greet and assist before CIQ clears. Fuel, services, third-party transport and bag handoff all wait.", r: "2.3" },
    { q: "When must Border Police be sent the details for an arrival from a third country?", o: ["On arrival, before passengers disembark", "At least 1 hour before the aircraft departs from abroad", "By 18:00 the day before", "Only if passengers are non-EEA citizens"], a: 1, e: "At least 1 hour before departure from abroad, and on arrival everyone goes straight to border control. Nationality does not exempt a movement.", r: "2.3" },
    { q: "A Category C aircraft is parking at BIKF on a normal stand. How is it marshalled?", o: ["Dotted yellow line, can power out", "Middle solid line, needs a pushback", "Any line, crew's choice", "Dotted yellow line, needs a pushback"], a: 1, e: "Cat C and larger use the middle solid line and require a pushback. Cat A/B use the dotted yellow line.", r: "3.1" },
    { q: "Which BIKF stands do not require a pushback for larger aircraft?", o: ["101 and 102", "220 and 221", "108 and 109", "All stands on the West Apron"], a: 1, e: "Stands 220 and 221 are the exception to the Cat C+ pushback rule.", r: "3.5" },
    { q: "How is a parking stand assigned at BIKF?", o: ["Ramp staff pick the nearest free stand", "Enter the aircraft in Veovo and APOC assigns the stand", "The crew request one from the tower", "The duty manager assigns it in Notion"], a: 1, e: "Every aircraft is entered manually in Veovo; APOC assigns and the stand shows on the arrival/departure line.", r: "3.3" },
    { q: "A military aircraft carrying dangerous goods is inbound to BIKF. What do you do?", o: ["Park it on stands 101–108", "Route it to the West Apron and call 693 5912 to open the gate", "Request a temporary DMA through APOC", "Park it at the FBO and inform Border Police"], a: 1, e: "Military/DG movements use the West Apron. Make the gate call early so the aircraft isn't held short.", r: "3.4" },
    { q: "At BIRK, an aircraft will be running its APU on stand. Where does it park?", o: ["Apron 1 North, no time limit", "Apron 1 Center, 20-minute APU limit", "At the Avgas pump", "Apron 1 North, 20-minute APU limit"], a: 1, e: "Apron 1 Center is for APU use (20 min). Apron 1 North is non-APU and long-term, with a 0-minute APU limit.", r: "4.2" },
    { q: "What must be placed around every parked aircraft at BIRK and BIAR?", o: ["Chocks only", "Cones at nose, tail and wingtips, as well as chocks", "Cones instead of chocks", "Tie-downs only in high wind"], a: 1, e: "Cones are a standing requirement in addition to chocks — not instead of them.", r: "4.1 / 5.1" },
    { q: "An Avgas aircraft from abroad parks at the BIRK Avgas pump. When can fuelling start?", o: ["Straight away — it's already at the pump", "Once CIQ has cleared, if clearance is required for that movement", "After the crew have paid", "Once the tower approves"], a: 1, e: "The CIQ rule applies in full at the pump. After fuelling, move the aircraft to the right ramp.", r: "4.3" },
  ]
},
{
  id: "m2", code: "P2", title: "GSE & Marshalling", part: "Part 2 · Sections 7–8",
  summary: "Safe operation of lav, water, GPU, air-stairs and tugs, and standard marshalling practice.",
  lesson: [
    { h: "Before you touch any equipment", key: true, html: `
      <p>Never operate a GSE unit you have not been trained and signed off on at IAA — even if you used similar equipment elsewhere. This module is a working reference, not a substitute for the GSE Operator Training Manual and practical sign-off.</p>
      <ul><li>PPE: hi-vis at all times, hearing protection near running engines/GPU, safety footwear, gloves for hoses and cables.</li>
      <li>Do a FOD check of the equipment's path, keep wingtip clearances, and never approach until engines are off and the beacon is off.</li></ul>` },
    { h: "Lavatory and potable water", html: `
      <ul>
        <li><b>Lav:</b> gloves and eye protection; connect with a positive lock; never disconnect while the aircraft valve is open. Waste is a biohazard.</li>
        <li><b>Water:</b> approved potable source only; the hose end must never touch the ground or any waste equipment; never share hoses or adapters with lav equipment.</li>
        <li>Record the service and the <b>quantity actually delivered</b> in the <b>Services Log</b> (Section 9.8).</li>
      </ul>` },
    { h: "GPU and air-stairs", html: `
      <ul>
        <li><b>GPU:</b> position clear of intakes and blast and chock it. The unit can be started and warmed up (60 seconds) before connecting, but the power output stays off. Check voltage/frequency, connect the cable and confirm the lock, and only then switch on the power output. To disconnect: switch off the power output, wait 60 seconds, then disconnect. Never connect or disconnect with the power output on.</li>
        <li><b>Air-stairs:</b> approach on the marshaller's signal; final positioning at creep speed only; brake and chock once mated; stay at the controls while people are on the stairs.</li>
      </ul>` },
    { h: "Tugs", html: `
      <ul>
        <li>Confirm the tug/towbar or cradle is rated for the type; check the shear pin or cradle lock before any tension.</li>
        <li>Talk to ground frequency when moving through areas with other traffic (e.g. A1N–A1C via Hotel).</li>
        <li>Walking pace, with a wing walker posted (not needed on taxiways). Watch the nose-gear steering limit — stop if unsure.</li>
      </ul>` },
    { h: "Marshalling", html: `
      <ul>
        <li>Stand ahead of the aircraft or to the side, in the captain's line of sight, with a safe retreat path. Illuminated wands at night or in low visibility.</li>
        <li>Signals are slow, deliberate and held. Wing walkers report to the marshaller, not the cockpit — except for an Emergency Stop.</li>
        <li><b>Anyone</b> who sees a hazard may give the Emergency Stop. If in doubt, stop.</li>
        <li>Marshalling authorisation is revalidated every 12 months, or sooner after an incident, procedure change or long absence.</li>
      </ul>` },
  ],
  quiz: [
    { q: "You operated air-stairs at your previous employer. Can you drive IAA's air-stairs unsupervised?", o: ["Yes, the procedure is the same", "Only on BIRK where traffic is lighter", "No — not until you are trained and signed off at IAA", "Yes, if a colleague watches the first time"], a: 2, e: "Never operate GSE you have not been trained and signed off on, even if you've used similar equipment elsewhere.", r: "7.1" },
    { q: "You have just serviced a lavatory with 20 L of fluid. Where do you record it?", o: ["In a comment on the handling request email", "In the Services Log, with the quantity", "On the paper unit log only", "Nowhere — lav service is included in handling"], a: 1, e: "Services and quantities go in the Services Log so dispatch can invoice correctly.", r: "7.2 / 9.8" },
    { q: "What must never touch the ground on a potable water unit?", o: ["The tank drain", "The hose end", "The parking brake lever", "The wheel chocks"], a: 1, e: "Keep the hose end off the ground and away from waste equipment — cross-contamination risk.", r: "7.3" },
    { q: "What is the correct order for connecting a GPU to the aircraft?", o: ["Start the unit, switch on the power output, then connect the cable", "Start and warm up the unit, connect the cable and confirm the lock, then switch on the power output", "Connect the cable, switch on the power output, then check voltage and frequency", "Crew connect it from the flight deck"], a: 1, e: "The unit can already be running, but the cable is only connected or disconnected with the power output off. Warm up, check voltage/frequency, connect and confirm the lock, then switch on the output.", r: "7.4" },
    { q: "How fast should air-stairs move during final positioning against the fuselage?", o: ["Walking pace", "Creep speed only", "Normal ramp speed", "Whatever the marshaller signals"], a: 1, e: "Never approach the fuselage above walking pace; final positioning must be creep speed only.", r: "7.5" },
    { q: "When towing, when is a wing walker not required?", o: ["At night", "On taxiways", "For aircraft under 10 tonnes", "Never — always required"], a: 1, e: "Move at walking pace with a wing walker posted, exempt on taxiways.", r: "7.6" },
    { q: "Who may give the Emergency Stop signal?", o: ["Only the marshaller", "Only the duty manager", "Anyone who observes a hazard", "Only the flight crew"], a: 2, e: "The Emergency Stop may be given by anyone who sees a hazard, regardless of role.", r: "8.2 / 23.1" },
    { q: "Where does the marshaller stand?", o: ["Directly under the nose", "Ahead of the aircraft or to the side, in the captain's line of sight", "Wherever the wing walkers can see you, even out of the captain's view", "Behind the aircraft"], a: 1, e: "Ahead of the aircraft or to the side, clearly visible to the captain, with a safe retreat path.", r: "8.3" },
    { q: "How often must marshalling authorisation be revalidated?", o: ["Every 3 years", "Every 12 months, or sooner after an incident or long absence", "Only after an incident", "Every 6 months"], a: 1, e: "12 months, or sooner after an incident, procedural change or extended absence.", r: "8.8" },
  ]
},
{
  id: "m3", code: "P3a", title: "Notion, Services Log & Automations", part: "Part 3 · Section 9",
  summary: "Notion as the source of truth, the icon and Ready to Sync rules, the Services Log, and how to work with the automations.",
  lesson: [
    { h: "Automations assist dispatch — they do not replace it", key: true, html: `
      <ul>
        <li>The automations save time on data entry and drafting. They do not check anything for you.</li>
        <li>Every flight, comment, email draft and catering entry an automation creates must be verified by dispatch against the original email and documents before it is relied on.</li>
        <li>Responsibility for accuracy stays with the Operations Officer on shift. “The automation entered it” is never a reason for a wrong flight, invoice or Border Police notification.</li>
        <li>If an automation gets something wrong, correct the entry and tell management so the error can be tracked.</li>
      </ul>` },
    { h: "Notion is the source of truth", html: `
      <ul>
        <li>The station databases, NetJets Catering, Services and the Isavia List live in the closed <b>Operations</b> teamspace.</li>
        <li>The ops@iaa.is account can add and update flights but cannot change properties, options or views. Structural changes go to Josh, Hjalti or Guðmundur.</li>
        <li>The calendar, Border Police emails and automations all read from Notion — a mistake in Notion spreads to all of them.</li>
      </ul>` },
    { h: "Icons", html: `
      <div class="tbl"><table>
        <tr><th>Icon</th><th>Meaning</th></tr>
        <tr><td>Green arrival plane</td><td>Not yet arrived</td></tr>
        <tr><td>Red departure plane</td><td>Landed, on the ground</td></tr>
        <tr><td>Red circle</td><td>Departed, awaiting invoice</td></tr>
        <tr><td>Green tick</td><td>Invoice sent or paid</td></tr>
        <tr><td>Blue fuel pump</td><td>Fuel/tech stop — arrives and departs the same day</td></tr>
        <tr><td>Red plus</td><td>Ambulance / medevac</td></tr>
        <tr><td>Red X</td><td>Cancelled — out of Border Police emails, red on calendar. Never delete.</td></tr>
      </table></div>` },
    { h: "Creating and verifying a flight", html: `
      <ol>
        <li>Check whether the automation has already created it — never make a duplicate.</li>
        <li>Title = registration, then flight number if known (e.g. 9H-VJO / VJH725).</li>
        <li>Fill in what the request gives you and immediately ask for anything missing: crew/pax, gendecs, fuel release, extra requests.</li>
        <li>Crew/pax: <span class="mono">2/3</span> = 2 crew, 3 pax in; <span class="mono">2/3 2/0</span> = 2/3 in, 2/0 out.</li>
        <li>Verify registration, times, type, MTOW, From/To, Invoice To, crew/pax and attachments — <b>then</b> tick <b>Ready to Sync</b>. Unticked flights stay off the calendar and out of the Border Police emails.</li>
      </ol>` },
    { h: "Comments", html: `
      <ul>
        <li>Log three stages: request received → confirmed with price (say whether supplier cost or client price) → what will be charged (catering fully itemised).</li>
        <li>Comments from <b>IAA Automations</b> are suggestions — nothing has been changed. Check against the email, make the change yourself if correct, and reply saying what you did.</li>
      </ul>` },
    { h: "Calendar and Services Log", html: `
      <ul>
        <li>The ops@iaa.is Google Calendar mirrors ticked flights automatically. Never create or edit flight events there — change Notion.</li>
        <li>Services go in the <b>Services Log</b> via the ramp phone page: service and quantity actually delivered, no prices. Missing service? Tell management — don't substitute.</li>
      </ul>` },
    { h: "The automations and your part", html: `
      <div class="tbl"><table>
        <tr><th>Automation</th><th>What dispatch must do</th></tr>
        <tr><td>Handling requests → Notion</td><td>Verify every new flight before ticking Ready to Sync; action proposed changes yourself; confirm flagged cancellations with the client.</td></tr>
        <tr><td>Border Police drafts (~20:30)</td><td>Check each draft against Notion and the gendecs, then send it yourself. Notify later changes directly.</td></tr>
        <tr><td>NetJets catering</td><td>Check each order against the email and linked flight; send any tail-number draft; confirm cancellations with NetJets.</td></tr>
        <tr><td>Out-of-hours auto-reply</td><td>Holding message only — reply personally at the start of the morning shift.</td></tr>
      </table></div>
      <p>If an automation seems to have stopped (no Border Police drafts by 21:00, requests not appearing), carry on manually and tell management straight away.</p>` },
  ],
  quiz: [
    { q: "The handling request automation has created a flight for tomorrow. What state is it in?", o: ["Ready to Sync ticked and on the calendar", "Ready to Sync unticked — it waits for dispatch to verify it", "Already sent to Border Police", "Invoiced automatically"], a: 1, e: "New automation-created flights arrive unticked and stay off the calendar and Border Police emails until dispatch has checked them.", r: "9.9" },
    { q: "What does ticking Ready to Sync mean?", o: ["The flight has been invoiced", "Your sign-off that you personally checked the entry — it then shows on the calendar and in Border Police emails", "The aircraft has landed", "The automation has finished processing it"], a: 1, e: "Ready to Sync is dispatch's sign-off. Never tick a flight you haven't checked.", r: "9.4" },
    { q: "An IAA Automations comment proposes changing the ETD to 14:30. What do you do?", o: ["Nothing — the automation has already changed it", "Check it against the referenced email, make the change yourself if correct, and reply to the comment", "Delete the comment", "Forward it to management"], a: 1, e: "Automation comments are suggestions only. Verify, action it yourself, and reply saying what you did.", r: "9.5" },
    { q: "At 20:40 there are Border Police drafts in ops@iaa.is. What is the correct action?", o: ["Leave them — they send automatically", "Check each one against Notion and the gendecs, then send it yourself", "Send them all without opening — they come from Notion", "Delete them and write new ones by hand"], a: 1, e: "They are drafts only. Dispatch checks and sends them.", r: "2.3 / 9.9" },
    { q: "A flight you created is missing from the calendar. What do you check first?", o: ["Whether Google Calendar is down", "Whether Ready to Sync is ticked", "Whether the icon is green", "Whether the flight has a comment"], a: 1, e: "Only ticked flights appear on the calendar. Check that box, then the entry itself.", r: "9.7" },
    { q: "Which icon shows an aircraft that has landed and is on the ground?", o: ["Green arrival plane", "Red departure plane", "Red circle", "Green tick"], a: 1, e: "Green arrival → red departure (on the ground) → red circle (departed, awaiting invoice) → green tick.", r: "9.1" },
    { q: "A client confirms a flight is cancelled. What do you do in Notion?", o: ["Delete the flight", "Set the red X icon and keep the flight", "Untick Ready to Sync only", "Move it to next week"], a: 1, e: "Never delete a cancelled flight — mark it with the red X. It then drops out of the Border Police emails.", r: "9.1" },
    { q: "You delivered 200 L of potable water, although 250 L was requested. What goes in the Services Log?", o: ["250 L — what was requested", "200 L — what was actually delivered", "Nothing, water is not logged", "200 L plus the price"], a: 1, e: "Record the quantity actually delivered. No prices go in the Services Log.", r: "9.8" },
    { q: "You think the BIKF database needs a new property. What should you do?", o: ["Add it from the ops@iaa.is account", "Ask Josh, Hjalti or Guðmundur", "Rename an existing property instead", "Add it on the calendar"], a: 1, e: "The ops account can't change properties or views, and the automations depend on current names.", r: "9 / 9.9" },
    { q: "A wrong MTOW went to Border Police because the automation extracted it wrongly and nobody checked. Who is responsible?", o: ["Nobody — it was automated", "The Operations Officer on shift", "The software provider", "Border Police for not spotting it"], a: 1, e: "Responsibility for accuracy stays with the Operations Officer on shift. “The automation entered it” is never a reason.", r: "9.9" },
    { q: "What does 2/3 2/0 mean in the Crew/Pax field?", o: ["2 flights, 3 legs", "2 crew and 3 pax in; 2 crew and 0 pax out", "2 crew, 3 pax, 2 bags, 0 catering", "Arrival 02:30, departure 02:00"], a: 1, e: "The first pair is arrival, the second is departure.", r: "9.3" },
    { q: "It's 21:15 and no Border Police drafts have appeared. What do you do?", o: ["Wait until morning", "Prepare the notifications manually and tell management straight away", "Tick more flights and hope they appear", "Nothing — Border Police will ask if they need it"], a: 1, e: "If an automation appears to have stopped, carry on manually and tell management. No task stops because an automation is down.", r: "9.9" },
    { q: "A flight time looks wrong on the Google Calendar but is correct in Notion. Where do you fix it?", o: ["Edit the calendar event", "Nowhere — Notion is correct; the sync will catch up. Only ever change Notion", "Delete the calendar event", "Email the calendar owner"], a: 1, e: "The calendar is a mirror. Never edit flight events directly; the sync overwrites them.", r: "9.7" },
  ]
},
{
  id: "m4", code: "P3b", title: "Invoicing, Clients & Data Protection", part: "Part 3 · Sections 10–12",
  summary: "Contract clients and SLAs, the Regla invoicing steps, and handling personal data.",
  lesson: [
    { h: "Clients and contracts", html: `
      <ul>
        <li>Always confirm pricing in the current <b>Contract References</b> document — it is the authoritative source. Tiers and rebates change.</li>
        <li><b>VistaJet</b>: new SGHA from 1 Aug 2026 at all three stations. A <b>50% rebate</b> on the handling fee applies if any timed service is missed by more than 10 minutes.</li>
        <li>NetJets/NJE and VistaJet SLAs carry real financial penalties — work to the client's own targets, not just the 30-minute default.</li>
      </ul>` },
    { h: "Billing notes", html: `
      <ul>
        <li>NetJets invoices with catering or de-icing → <b>josh@iaa.is, gtv@iaa.is, hjalti@iaa.is</b>.</li>
        <li>Flexjet: IAA catering on a separate invoice, to the same three addresses.</li>
        <li>Pilatus: all invoices to <b>gtv@iaa.is</b>.</li>
        <li>Air Journey: only the transport invoice goes on the Air Journey account; flights are “Paid on Delivery”.</li>
        <li>Alpha2Bravo: discount applies automatically in Regla.</li>
      </ul>` },
    { h: "Regla — registering an invoice", html: `
      <ol>
        <li>Customer = the <b>paying</b> customer, not necessarily the operator.</li>
        <li>Regarding/Job = aircraft registration.</li>
        <li>Comments: billing address for Paid on Delivery; otherwise ICAO code and flight dates (month and year).</li>
        <li>Include the client's order/reference number if given.</li>
        <li>Invoice date = arrival date, or at the latest the departure date.</li>
        <li>Check products and prices against Contract References.</li>
        <li>Verify services in Notion — the flight, its comments and the Services Log. Never invoice from an unverified automation entry or catering order.</li>
      </ol>
      <p>Send with the template and ask for payment confirmation to <span class="mono">accounts@reykjavikfbo.is</span>. Sign with your own name.</p>` },
    { h: "Data protection", html: `
      <ul>
        <li>Personal data (names, passports, itineraries, sometimes health information) arrives by email and is recorded in Notion. Some of this is now automated, including an AI service that reads handling requests.</li>
        <li>When checking automation entries, make sure personal data sits on the correct flight.</li>
        <li>Default retention: <b>60 days after the specific flight or service</b>.</li>
        <li>Report any suspected data incident (misdirected email, wrong passenger data on a draft) to your station manager and the Data Protection Lead immediately — even if caught before sending.</li>
        <li>Pass access, correction or deletion requests to the Data Protection Lead — don't answer them yourself.</li>
      </ul>` },
  ],
  quiz: [
    { q: "In Regla, who is the Customer on the invoice?", o: ["Always the aircraft operator", "The paying customer — which may differ from the operator", "The handling agent who sent the request", "IAA"], a: 1, e: "The paying customer and the operator are not always the same — check every time.", r: "11.1" },
    { q: "What goes in the Regarding/Job field?", o: ["The flight number", "The aircraft registration", "The ICAO code", "The client's reference"], a: 1, e: "Regarding/Job is always the aircraft registration.", r: "11.1" },
    { q: "What should the invoice date be?", o: ["The day you create the invoice", "The arrival date, or at the latest the departure date", "The last day of the month", "The payment due date"], a: 1, e: "Arrival date, or at the latest departure date.", r: "11.1" },
    { q: "A NetJets invoice includes catering. Who must it go to?", o: ["NetJets accounts directly", "josh@iaa.is, gtv@iaa.is and hjalti@iaa.is", "accounts@reykjavikfbo.is only", "The caterer"], a: 1, e: "Those three addresses create the individual price breakdown for each order.", r: "10.2" },
    { q: "Where do Pilatus invoices go?", o: ["The Pilatus contact in Regla", "gtv@iaa.is", "ops@iaa.is", "The pilot"], a: 1, e: "All Pilatus invoices go directly to gtv@iaa.is instead of the contact assigned by the system.", r: "10.2" },
    { q: "Under the VistaJet SGHA, what happens if a timed service is missed by more than 10 minutes?", o: ["A written warning", "A 50% rebate on the handling fee", "Nothing if the crew don't complain", "A 10% discount"], a: 1, e: "A 50% handling-fee rebate applies, plus a separate penalty for lost baggage.", r: "10.1" },
    { q: "Which source is authoritative for client pricing?", o: ["This training module", "The current Contract References document", "The last invoice you sent", "Your memory of the rate"], a: 1, e: "Always confirm pricing in Contract References — rates and rebates change.", r: "10" },
    { q: "Where should the client send payment confirmation?", o: ["ops@iaa.is", "accounts@reykjavikfbo.is", "josh@iaa.is", "The person who sent the invoice"], a: 1, e: "The invoice template asks for payment confirmation to accounts@reykjavikfbo.is.", r: "11.2" },
    { q: "How long is operational personal data kept by default?", o: ["60 days after the contract ends", "60 days after the specific flight or service", "1 year", "Forever, in Notion"], a: 1, e: "60 days after completion of the specific flight or service, on a rolling basis.", r: "12.3" },
    { q: "You notice a Border Police draft contains passenger names from a different flight. You fix it before sending. Is anything else needed?", o: ["No — it was never sent", "Yes — report it as a potential data incident", "Only if the passenger complains", "Delete the draft and say nothing"], a: 1, e: "Wrong passenger data on a draft or entry is a potential data incident — report it even if caught before sending.", r: "12.1 / 12.4" },
    { q: "Before finalising an invoice, what must you check?", o: ["Only the handling request", "The flight in Notion, its comments and the Services Log — and that any automation entries were verified", "Nothing, Regla calculates it", "The calendar event"], a: 1, e: "Invoices must match verified Notion records. Never invoice from an unverified automation entry.", r: "11.1" },
  ]
},
{
  id: "m5", code: "P4", title: "Communication & Customer Service", part: "Part 4 · Sections 13–18",
  summary: "Response times, email and phone standards, discretion with VIPs, complaints, and handovers.",
  lesson: [
    { h: "Response times are contractual", key: true, html: `
      <ul>
        <li>Many clients require acknowledgement within <b>30 minutes</b> — missing it can mean free or discounted handling.</li>
        <li>A reply that confirms receipt and next steps counts. Silence does not. Forwarding to management is not a reply — acknowledge the client yourself.</li>
        <li>Some SLAs (NetJets/NJE, VistaJet) are stricter — work to theirs.</li>
        <li>The out-of-hours auto-reply (23:00–06:30 UTC) is a holding message only. Pick up and personally reply to every request it answered at the start of the morning shift.</li>
      </ul>` },
    { h: "Email and phone", html: `
      <ul>
        <li>Professional, warm, concise. Confirm what you understood — times, quantities, billing.</li>
        <li>Specific subject lines: registration and date, or the request.</li>
        <li>On the phone: identify yourself and IAA, read key details back, and follow up any verbal agreement by email or Notion comment.</li>
      </ul>` },
    { h: "Discretion and VIPs", html: `
      <ul>
        <li>Never discuss who is travelling with anyone outside the handling. No photos of passengers, aircraft or tail numbers without management authorisation.</li>
        <li>Media or public asking about a passenger: don't confirm or deny — refer to management.</li>
        <li>Open Notion records on a need-to-know basis only. When in doubt, say nothing.</li>
      </ul>` },
    { h: "Complaints", html: `
      <ul>
        <li>Acknowledge calmly, don't admit fault, promise refunds or argue.</li>
        <li>Pass it to management with the full context and tell the client when they'll hear back.</li>
      </ul>` },
    { h: "Handovers", html: `
      <ul>
        <li>Every active flight in Notion shows its true status. Anything time-critical goes in the <b>WhatsApp</b> group.</li>
        <li>Hand over automation work too: unverified flights, unanswered IAA Automations comments, unsent Border Police drafts, catering orders waiting on a tail number.</li>
        <li>Dispatch covers all three stations, wherever you are sitting.</li>
      </ul>` },
  ],
  quiz: [
    { q: "What is the common acknowledgement target for client emails?", o: ["Within 2 hours", "Within 30 minutes", "Same working day", "Within 10 minutes for all clients"], a: 1, e: "Commonly under 30 minutes — some SLAs are stricter.", r: "14" },
    { q: "A request needs a management decision. You forward it to Hjalti. Have you met the response target?", o: ["Yes, forwarding counts", "No — you must still acknowledge the client yourself within the target", "Yes, if Hjalti replies within 30 minutes", "Only for non-contract clients"], a: 1, e: "Forwarding is not a substitute for replying to the client.", r: "14.1" },
    { q: "A handling request arrived at 02:00 and got the out-of-hours auto-reply. What happens next?", o: ["Nothing — it's been acknowledged", "The morning shift picks it up and personally replies", "The client must re-send it", "Wait for the client to chase"], a: 1, e: "The auto-reply is a holding message. Every request it answered gets a personal reply at the start of the morning shift.", r: "14.1" },
    { q: "A journalist at the fence asks if a well-known singer just landed. What do you say?", o: ["Confirm it — it's public knowledge", "Neither confirm nor deny, and refer them to management", "Deny it", "Point them to the terminal"], a: 1, e: "Never confirm or deny who is on an aircraft. Refer media enquiries to management.", r: "16.2" },
    { q: "A client is angry about a delayed crew car and demands a discount. What do you do?", o: ["Offer 20% off to calm things down", "Acknowledge professionally, make no promises, and escalate to management with full context", "Explain it wasn't your fault", "Ignore it until they calm down"], a: 1, e: "Don't negotiate or offer compensation — acknowledge and escalate.", r: "17" },
    { q: "Where do you flag an ongoing delay at shift change?", o: ["Only in Notion", "In Notion and directly in the WhatsApp group", "In an email to yourself", "Nowhere, the next shift will see it"], a: 1, e: "Notion holds the record; anything time-critical is flagged directly in WhatsApp.", r: "18.1" },
    { q: "You're based at BIRK and a BIAR request comes in during your dispatch shift. Whose job is it?", o: ["The BIAR team's", "Yours — dispatch covers all three stations", "Whoever sees it first tomorrow", "The duty manager's"], a: 1, e: "Dispatch responsibility is not station-bound.", r: "18.2" },
    { q: "You agree a pickup time with a captain by phone. What else should you do?", o: ["Nothing, it's agreed", "Confirm it by email or a Notion comment", "Write it on a sticky note", "Tell a colleague verbally"], a: 1, e: "Follow up verbal agreements in writing — they are easy to lose at handover.", r: "15.3" },
    { q: "Can you post a photo of a nice aircraft on the ramp to your personal social media?", o: ["Yes, if no passengers are visible", "Not without explicit authorisation from management", "Yes, after it has departed", "Yes, if you blur the tail number"], a: 1, e: "No photos of aircraft, tail numbers or ramp activity that could identify travellers without management authorisation.", r: "16.1" },
  ]
},
{
  id: "m6", code: "P5", title: "De-Icing, Fuel, AOG & Emergencies", part: "Part 5 · Sections 19–23",
  summary: "Third-party de-icing and fuel, AOG handling with Flugverk, incident reporting and emergency actions.",
  lesson: [
    { h: "De-icing", html: `
      <ul>
        <li>Provided by <b>Icelandair ehf</b> — we request, sequence and confirm it.</li>
        <li>Request early with registration, type, stand and time. Log it in Notion.</li>
        <li>De-ice as close to departure as possible: after boarding and catering, before pushback.</li>
        <li>The flight crew set holdover time. If departure is delayed after de-icing, <b>tell the crew immediately</b>.</li>
        <li>Confirm completion with Icelandair ehf and the crew before releasing; record fluid type and time.</li>
      </ul>` },
    { h: "Fuel", html: `
      <div class="tbl"><table>
        <tr><th>Station</th><th>Jet A-1</th><th>Avgas</th></tr>
        <tr><td>BIRK</td><td>Skeljungur, D2A</td><td>Self-service pump; truck for large quantities (advance notice)</td></tr>
        <tr><td>BIKF</td><td>EAK, D2A</td><td>Not standard — confirm with EAK</td></tr>
        <tr><td>BIAR</td><td>Icelandair fuel desk, D2A</td><td>Self-service pump; truck for large quantities (advance notice)</td></tr>
      </table></div>
      <p>CIQ applies before any fuelling. Report any discrepancy, contamination or spill.</p>` },
    { h: "AOG", html: `
      <ol>
        <li>Contact <b>Flugverk</b> to arrange engineering.</li>
        <li>Notify the duty manager and the client within the response target.</li>
        <li>Update Notion straight away and log each update.</li>
        <li>Sort out stand implications with APOC/duty manager.</li>
      </ol>
      <p>Flugverk is the technical authority — relay their updates, don't guess repair times. Flag an ongoing AOG in the WhatsApp handover.</p>` },
    { h: "Incident reporting — both channels, every time", key: true, html: `
      <ul>
        <li>Report through IAA's internal system <b>and</b> the airport authority's system — never one instead of the other.</li>
        <li>Make safe first. Internal report before the end of your shift.</li>
        <li>Report injuries, any aircraft/GSE contact (even with no visible damage), FOD, near-misses, fuel issues, dangerous goods, security, and de-icing/AOG events that went wrong.</li>
        <li>Unsure? Report it anyway.</li>
      </ul>` },
    { h: "Emergencies", html: `
      <ul>
        <li>Make yourself and others safe first. Alert others and call ARFF/emergency and the duty manager early.</li>
        <li><b>Fuel spill:</b> stop fuelling, shut off the source if safe, keep ignition sources and GSE clear, notify the supplier and duty manager.</li>
        <li><b>Suspicious item:</b> don't touch it, move people away, notify Border Police/security and the duty manager.</li>
        <li>The aerodrome's own emergency procedures always take precedence.</li>
      </ul>` },
  ],
  quiz: [
    { q: "Who provides de-icing at IAA's stations?", o: ["IAA ramp staff", "Icelandair ehf", "Isavia", "The fuel supplier"], a: 1, e: "De-icing is a third-party service by Icelandair ehf. IAA coordinates, sequences and confirms.", r: "19" },
    { q: "The departure is delayed 25 minutes after de-icing finished. What do you do?", o: ["Nothing — the crew will know", "Tell the crew immediately so they can check their holdover time", "Order a second de-icing yourself", "Record it in Notion only"], a: 1, e: "Delays erode holdover. Tell the crew straight away; they decide whether re-application is needed.", r: "19.2" },
    { q: "Who supplies Jet A-1 at BIKF?", o: ["Skeljungur", "EAK", "Icelandair", "Self-service pump"], a: 1, e: "EAK at BIKF; Skeljungur at BIRK; Icelandair fuel desk at BIAR.", r: "20" },
    { q: "A crew reports a technical fault that will stop departure. What is your first action?", o: ["Estimate the repair time for the client", "Contact Flugverk to arrange engineering", "Tow the aircraft to Apron 1 North", "Cancel the flight in Notion"], a: 1, e: "Flugverk is IAA's AOG partner and the technical authority on status and timeline.", r: "21.1" },
    { q: "A tug lightly touches a GPU. No visible damage. What must you report?", o: ["Nothing — no damage", "Report through IAA's internal system and the airport authority's system", "Only the internal report", "Only tell the duty manager"], a: 1, e: "Any contact, even without visible damage, is reportable — through both channels.", r: "22.1" },
    { q: "When must the internal incident report be made?", o: ["Within a week", "As soon as practical, and before the end of your shift", "At the monthly safety meeting", "Only if the airport authority asks"], a: 1, e: "Make the area safe first, then report before the end of your shift.", r: "22.2" },
    { q: "You're not sure an event is serious enough to report. What should you do?", o: ["Skip it", "Report it anyway", "Ask the crew", "Wait and see if anyone complains"], a: 1, e: "A precautionary report costs little; an unreported incident is a much bigger risk.", r: "22.2" },
    { q: "Fuel is spilling during fuelling. Which is correct?", o: ["Finish fuelling quickly, then clean up", "Stop fuelling, shut off the source if safe, keep ignition sources clear, notify the supplier and duty manager", "Start the APU to move the aircraft", "Hose it away with water"], a: 1, e: "Stop, isolate if safe, keep ignition sources away, notify, and follow the airport's spill procedure.", r: "23.4" },
    { q: "You find an unattended bag airside. What do you do?", o: ["Open it to check for a name tag", "Don't touch it; move people away; notify Border Police/security and the duty manager", "Take it to lost property", "Leave it and carry on"], a: 1, e: "Never touch or move a suspicious item. Clear the area and notify.", r: "23.5" },
  ]
},
]
};
