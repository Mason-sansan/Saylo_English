/**
 * Generates data/conversation-scenes.json: 35 scenarios per CEFR level
 * (18 work + 17 life), with difficulty scaled per level.
 * Run: node scripts/build-conversation-scenes.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'conversation-scenes.json');

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * 35 archetypes: first 18 domain "work", last 17 domain "life".
 * Each has roles + per-level title, setting, firstLine (and optional goals).
 */
const ARCHETYPES = [
  {
    domain: 'work',
    slug: 'front-desk-signin',
    coachRole: 'Receptionist',
    learnerRole: 'Visitor',
    A1: {
      title: 'Office — sign in',
      setting: 'You visit an office. You must sign in at the desk.',
      firstLine: 'Hello. What is your name? And who are you here to see today?',
      learnerGoals: ['Say your name.', 'Say one person or team name.'],
    },
    A2: {
      title: 'Front desk check-in',
      setting: 'You arrive for a meeting and the reception desk needs basic details before they print a badge.',
      firstLine: 'Hi there — can I get your full name, the company you are with, and who you are meeting?',
    },
    B1: {
      title: 'Visitor registration',
      setting: 'You are checking in at a company lobby; security rules require a host name and ID.',
      firstLine: 'Welcome. I need your ID for the visitor log, the name of your host, and whether you have a laptop to register — what should I put down?',
    },
    B2: {
      title: 'Lobby registration under tightened policy',
      setting: 'New lobby rules require purpose of visit and equipment; you want a smooth check-in without delays.',
      firstLine: 'We have to capture visit purpose and any devices on the badge request — walk me through who invited you, what you are delivering or discussing, and what you are carrying in.',
    },
    C1: {
      title: 'High-security visitor intake',
      setting: 'You are visiting a site with split compliance rules; the receptionist must reconcile access and confidentiality.',
      firstLine: 'Before I issue access, I need to align three things: who sponsored you, whether your discussion touches confidential data, and what level of floor access your host pre-approved — how do you want to frame that?',
    },
    C2: {
      title: 'Executive site visit — access boundaries',
      setting: 'A sensitive briefing overlaps with a wider team floor; you must negotiate what access is defensible.',
      firstLine: 'We are tight on scope today: I can either route you to the executive briefing room under escort, or widen badge access with legal sign-off — which risk trade-off does your host want to own, and what are you explicitly not cleared to hear?',
    },
  },
  {
    domain: 'work',
    slug: 'retail-shift-handover',
    coachRole: 'Shift supervisor',
    learnerRole: 'Sales assistant',
    A1: {
      title: 'Shop — shift change',
      setting: 'Your work shift is ending. Your supervisor asks a short question.',
      firstLine: 'Hi — quick handover. What is low in stock, and did any customer complain today?',
    },
    A2: {
      title: 'Retail handover',
      setting: 'You finish a shift at a small shop and must pass notes to the next staff.',
      firstLine: 'Before you clock out — what ran low on the floor, any returns I should know about, and anything odd with the card reader?',
    },
    B1: {
      title: 'End-of-shift retail notes',
      setting: 'You hand over to the closing supervisor; they need inventory and customer issues.',
      firstLine: 'I need a tight handover: top three SKUs that moved, any unhappy customers and how you handled it, and whether cash matches the drawer — what is your summary?',
    },
    B2: {
      title: 'Shift turnover with shrink risk',
      setting: 'Inventory discrepancies rose last week; handover must flag patterns without blame.',
      firstLine: 'Give me the operational picture: what sold through, what felt off in counts or voids, and what you want the next shift to double-check before close.',
    },
    C1: {
      title: 'Handover under audit pressure',
      setting: 'Auditors asked for traceable notes; you must balance speed and accountability.',
      firstLine: 'I need a defensible handover — what changed materially since open, what evidence supports it, and what you are uncertain about that I should escalate rather than assume?',
    },
    C2: {
      title: 'Crisis week retail continuity',
      setting: 'Supply noise and staff shortages overlap; the handover must set strategic priorities.',
      firstLine: 'Frame this not as tasks but risk: what threatens revenue or compliance tonight, what you mitigated, and what decision you need from me in the next ten minutes — with one hard number if possible.',
    },
  },
  {
    domain: 'work',
    slug: 'standup-micro',
    coachRole: 'Team lead',
    learnerRole: 'Team member',
    A1: {
      title: 'Quick work question',
      setting: 'Your boss asks what you did today at work.',
      firstLine: 'Hi. What did you finish today? And what is your problem — one thing only?',
    },
    A2: {
      title: 'Short stand-up',
      setting: 'Your team has a quick daily meeting; you give a short update.',
      firstLine: 'Quick round — what did you complete since yesterday, and what is blocking you right now?',
    },
    B1: {
      title: 'Daily standup update',
      setting: 'You report progress and one blocker in a time-boxed standup.',
      firstLine: 'We only have a minute each — what shipped, what is stuck, and what help do you need from the room?',
    },
    B2: {
      title: 'Standup with cross-team dependency',
      setting: 'Your update must surface a dependency without derailing the whole meeting.',
      firstLine: 'Give your update in three beats: outcome, confidence level, and the one dependency that could slip the date if we ignore it — what are they?',
    },
    C1: {
      title: 'Standup under delivery pressure',
      setting: 'Leadership is listening for honesty versus optimism; you calibrate the message.',
      firstLine: 'I want signal, not morale — what is objectively done, what is fragile, and what would you stop doing this week to protect the commitment we already made?',
    },
    C2: {
      title: 'Executive stand-in standup',
      setting: 'You represent a team in front of a skeptical director.',
      firstLine: 'In one minute: defend the current milestone, name the single assumption that could invalidate our plan, and tell me what authority you need unlocked — no filler.',
    },
  },
  {
    domain: 'work',
    slug: 'colleague-email-miss',
    coachRole: 'Coworker',
    learnerRole: 'Project teammate',
    A1: {
      title: 'Email problem',
      setting: 'A coworker thinks you did not answer an email.',
      firstLine: 'Hi. I sent you an email yesterday. Did you see it? Can you answer today?',
    },
    A2: {
      title: 'Missed email follow-up',
      setting: 'A colleague needs a reply you may have missed.',
      firstLine: 'Hey — I emailed yesterday about the shared doc. Did it reach you, and when can you take a look?',
    },
    B1: {
      title: 'Chasing a project email',
      setting: 'A deadline depends on your input; your coworker checks in politely but firmly.',
      firstLine: 'I need your sign-off on the draft by tomorrow — can you confirm you saw my thread, and if not, what is the fastest way to get your eyes on it today?',
    },
    B2: {
      title: 'Thread drift and ownership',
      setting: 'Multiple emails crossed; you clarify ownership without damaging the relationship.',
      firstLine: 'We have parallel threads and conflicting versions — can you tell me which file you treat as source of truth, and whether you want me to consolidate or you will?',
    },
    C1: {
      title: 'Escalation risk on communication gap',
      setting: 'Stakeholders inferred silence as delay; you repair process and substance.',
      firstLine: 'Silence got interpreted as a slip — walk me through what you actually blocked on, what you need from me to unblock, and how we prevent the next miss without more process theater.',
    },
    C2: {
      title: 'Political cost of inbox debt',
      setting: 'A partner team is building a narrative; you reset norms at senior peer level.',
      firstLine: 'I am going to be direct: your non-response became ammunition in a prioritization fight — what is the accurate story, what trade-off you were protecting, and what explicit SLA do you want going forward?',
    },
  },
  {
    domain: 'work',
    slug: 'client-order-phone',
    coachRole: 'Client services',
    learnerRole: 'Account manager',
    A1: {
      title: 'Client phone — order',
      setting: 'A client calls about an order. You answer.',
      firstLine: 'Hello, this is support. What is your order number? What is the problem?',
    },
    A2: {
      title: 'Customer order call',
      setting: 'A customer calls about a wrong shipment; you gather facts.',
      firstLine: 'Thanks for calling — can you give me the order ID, what you expected, and what arrived instead?',
    },
    B1: {
      title: 'Shipment mismatch triage',
      setting: 'You represent the vendor; the client is annoyed but reasonable.',
      firstLine: 'I want to fix this quickly — confirm the PO, the SKU you expected versus what the packing slip shows, and whether you can send a photo so we can authorize a replacement.',
    },
    B2: {
      title: 'Commercial relationship under error',
      setting: 'The error touches a renewal; you balance remedy and contract language.',
      firstLine: 'Walk me through timeline impact, what the client already told their boss, and whether we are discussing a credit, a redo, or a process fix — I need one recommendation.',
    },
    C1: {
      title: 'Key account recovery call',
      setting: 'Trust is dented; you probe root cause and signal seriousness.',
      firstLine: 'Before we talk solution, I want the narrative straight: what broke in our chain, what you already promised internally, and what would count as a credible repair beyond a one-off exception?',
    },
    C2: {
      title: 'Contractual exposure on repeated failures',
      setting: 'Legal and ops are in the loop; you negotiate a bounded settlement.',
      firstLine: 'We are past goodwill gestures — map the failure mode, quantify business impact conservatively, and tell me what remedy stays inside our standard terms versus what needs an amendment.',
    },
  },
  {
    domain: 'work',
    slug: 'it-password-reset',
    coachRole: 'IT help desk',
    learnerRole: 'Employee',
    A1: {
      title: 'Computer password',
      setting: 'You cannot log in. IT helps you.',
      firstLine: 'Hi, IT here. What is your work email? Can you tell me the error message on the screen?',
    },
    A2: {
      title: 'Password reset request',
      setting: 'You locked your account; IT verifies identity and resets access.',
      firstLine: 'I can help — what is your employee ID or email, and are you on a work laptop or personal device right now?',
    },
    B1: {
      title: 'Access lockout triage',
      setting: 'You need tools for a deadline; IT follows security steps.',
      firstLine: 'Let us get you back in — confirm your username, whether MFA is prompting, and if you recently changed devices so we pick the right reset path.',
    },
    B2: {
      title: 'Security exception under deadline',
      setting: 'Policy blocks a fast reset; you negotiate a compliant workaround.',
      firstLine: 'Standard reset will cost you hours — tell me the business deadline, what systems you must reach, and whether your manager can approve a temporary elevated path.',
    },
    C1: {
      title: 'Insider risk vs productivity',
      setting: 'Unusual login patterns triggered controls; you explain trade-offs.',
      firstLine: 'We flagged activity that looks like credential sharing — help me understand legitimate context, what access you actually need, and what audit trail we can leave that satisfies security without blocking delivery.',
    },
    C2: {
      title: 'Post-breach tightening',
      setting: 'Org-wide controls landed mid-project; you align exception governance.',
      firstLine: 'We are not debating convenience — which workflows are safety-critical, which assumptions in your project require exceptions, and who will sign the residual risk if we grant them?',
    },
  },
  {
    domain: 'work',
    slug: 'interview-schedule',
    coachRole: 'Recruiter',
    learnerRole: 'Hiring manager',
    A1: {
      title: 'Interview time',
      setting: 'You plan an interview with a recruiter.',
      firstLine: 'Hi. When can you interview the candidate? Morning or afternoon?',
    },
    A2: {
      title: 'Scheduling a candidate',
      setting: 'You coordinate a simple interview slot with recruiting.',
      firstLine: 'We have a strong candidate — what days work for your panel, and do you prefer video or on-site?',
    },
    B1: {
      title: 'Panel interview logistics',
      setting: 'Multiple calendars conflict; you lock a workable slot.',
      firstLine: 'I need a 90-minute panel next week — who must be in the room, what flexibility do you have on day, and should we record a debrief right after?',
    },
    B2: {
      title: 'Competing priorities on hiring',
      setting: 'Delivery pressure fights interview time; you negotiate a fair slot.',
      firstLine: 'Your team is underwater — tell me the minimum viable panel, the latest acceptable date without losing the candidate, and what you want assessed versus deferred to a second round.',
    },
    C1: {
      title: 'Calibration before final round',
      setting: 'Bias and bar drift are concerns; you align evaluation criteria.',
      firstLine: 'Before we schedule, I want the rubric explicit — what differentiates hire from no-hire for you, what evidence you need in-round, and how we document decisions if the panel splits?',
    },
    C2: {
      title: 'Executive search timing conflict',
      setting: 'Board timeline compresses hiring; you manage optics and process.',
      firstLine: 'We are being pushed to shortcut diligence — what are we willing to stake on a fast decision, what must not be skipped without reputational risk, and who owns the narrative if this hire misfires?',
    },
  },
  {
    domain: 'work',
    slug: 'expense-clarify',
    coachRole: 'Finance analyst',
    learnerRole: 'Employee',
    A1: {
      title: 'Expense question',
      setting: 'Finance asks about your expense report.',
      firstLine: 'Hello. One line on your report is not clear. What is this $40 for?',
    },
    A2: {
      title: 'Expense line item check',
      setting: 'A receipt is missing or unclear; finance emails you.',
      firstLine: 'Can you clarify the dinner charge on May 3 — who attended and was it client-facing?',
    },
    B1: {
      title: 'Expense policy clarification',
      setting: 'A claim sits in limbo; you resolve it with finance.',
      firstLine: 'We need documentation for the mileage block — what route, business purpose, and can you attach a map or meeting invite so we can release payment?',
    },
    B2: {
      title: 'Gray-area travel spend',
      setting: 'Policy interpretation differs by region; you seek a consistent ruling.',
      firstLine: 'This looks like mixed personal and business travel — walk me through intent, what was incremental cost, and what your manager already approved verbally so we can align with policy.',
    },
    C1: {
      title: 'Audit sampling hits your claims',
      setting: 'Sampling expanded; you defend legitimacy without being defensive.',
      firstLine: 'Auditors want narrative, not receipts alone — what business outcome each disputed spend supported, who benefited, and what control gap we should close so this does not repeat?',
    },
    C2: {
      title: 'Fraud signal investigation',
      setting: 'Pattern triggers review; you cooperate at principle level.',
      firstLine: 'We are obligated to ask hard questions — help me reconstruct timelines, identify anyone with shared card access, and tell me what innocent explanation fits the data without asking you to guess our thresholds.',
    },
  },
  {
    domain: 'work',
    slug: 'room-booking-conflict',
    coachRole: 'Office coordinator',
    learnerRole: 'Team member',
    A1: {
      title: 'Meeting room',
      setting: 'Two people want the same room.',
      firstLine: 'Hi. Room B is booked for two meetings. Which meeting can move?',
    },
    A2: {
      title: 'Double-booked room',
      setting: 'You mediate a scheduling clash for a meeting room.',
      firstLine: 'Both teams booked Room B at 2 — which meeting is easier to move, and do you need AV for the alternative?',
    },
    B1: {
      title: 'Room conflict resolution',
      setting: 'A client workshop conflicts with an internal sync.',
      firstLine: 'We have a hard conflict on the large room — which event has external stakeholders, what is the backup space you can accept, and how much setup time do you need?',
    },
    B2: {
      title: 'Resource contention week',
      setting: 'Multiple teams claim priority; you need a decision rule.',
      firstLine: 'Give me the business impact of each meeting, whether either can go hybrid, and what executive sponsor should break the tie if neither moves voluntarily.',
    },
    C1: {
      title: 'Facilities under cost review',
      setting: 'Room consolidation is rumored; you negotiate workable norms.',
      firstLine: 'We are being asked to cut footprint — which meetings truly require physical presence, what hybrid standard you can live with, and what fairness principle should govern recurring holds versus ad hoc?',
    },
    C2: {
      title: 'HQ redesign politics',
      setting: 'Leadership uses space as power signal; you argue for operational reality.',
      firstLine: 'Space decisions are becoming a proxy for status — make the case for what work actually requires colocation, what signal sends to clients, and what political cost you are willing to absorb to protect deep-work capacity.',
    },
  },
  {
    domain: 'work',
    slug: 'boss-status-ping',
    coachRole: 'Manager',
    learnerRole: 'Individual contributor',
    A1: {
      title: 'Boss asks progress',
      setting: 'Your manager asks a simple question in the hall.',
      firstLine: 'Hi. How is the report? Is it finished today?',
    },
    A2: {
      title: 'Quick status check',
      setting: 'Your manager wants a brief update on a task.',
      firstLine: 'Hey — where are we on the client deck, and do you need anything from me to finish?',
    },
    B1: {
      title: 'Manager checkpoint',
      setting: 'You owe a concise status on a slipping task.',
      firstLine: 'I need a honest snapshot: percent complete, what changed since Monday, and whether you are still comfortable with Friday — what is your read?',
    },
    B2: {
      title: 'Pressure without micromanagement',
      setting: 'Your boss senses risk; you re-establish trust with specifics.',
      firstLine: 'Help me understand variance — what assumptions broke, what you already mitigated, and what decision you need from me today versus what you can own silently?',
    },
    C1: {
      title: 'Credibility repair after a miss',
      setting: 'A prior deadline slipped; you frame learning and controls.',
      firstLine: 'I am not looking for excuses — what systemic issue caused the miss, what you changed this week, and what early warning metric you want me to watch next time?',
    },
    C2: {
      title: 'Career-limiting visibility',
      setting: 'Executives linked your name to a failure narrative.',
      firstLine: 'We need a narrative reset grounded in fact — what you owned versus what was ambiguous in scope, what evidence supports your version, and what risky project you still want after this?',
    },
  },
  {
    domain: 'work',
    slug: 'vendor-late-delivery',
    coachRole: 'Vendor account rep',
    learnerRole: 'Buyer',
    A1: {
      title: 'Late delivery call',
      setting: 'Your order is late. You call the company.',
      firstLine: 'Hello. My order is late. When will it arrive?',
    },
    A2: {
      title: 'Supplier delay',
      setting: 'Materials are late; you ask for a realistic ETA.',
      firstLine: 'Our PO 4477 is past due — what is the revised ship date and what caused the delay?',
    },
    B1: {
      title: 'Vendor slip impacts production',
      setting: 'You need a recovery plan, not apologies.',
      firstLine: 'This hits our line Friday — confirm root cause, give me a date you will stake your name on, and tell me what expedite options exist at what cost.',
    },
    B2: {
      title: 'Contractual remedy discussion',
      setting: 'SLA language is fuzzy; you probe remedies without lawyering every line.',
      firstLine: 'Walk me through force majeure versus operational failure, what credits you are authorized to offer, and how we document this so procurement does not fight finance.',
    },
    C1: {
      title: 'Strategic supplier relationship',
      setting: 'You cannot burn the bridge; you still need leverage.',
      firstLine: 'We are evaluating dual-sourcing — what structural changes you will commit to prevent recurrence, what transparency you will give on capacity, and what economics make staying preferred for both sides?',
    },
    C2: {
      title: 'Board-level supply shock',
      setting: 'Disclosure timing matters; you negotiate transparency and liability.',
      firstLine: 'Material impact is likely — what do you know versus suspect, what are you willing to put in writing today, and what governance do we need if this crosses into customer-facing commitments?',
    },
  },
  {
    domain: 'work',
    slug: 'open-office-noise',
    coachRole: 'Deskmate',
    learnerRole: 'Colleague',
    A1: {
      title: 'Too loud at work',
      setting: 'Your neighbor at work is loud. You speak politely.',
      firstLine: 'Excuse me. Please talk a little quieter. I need quiet to work.',
    },
    A2: {
      title: 'Noise in open office',
      setting: 'You ask a coworker to lower call volume.',
      firstLine: 'Hey — I am on a tight deadline; could you take long calls in the booth or lower your voice a bit?',
    },
    B1: {
      title: 'Open floor distraction',
      setting: 'Repeated loud meetings at a nearby desk hurt focus.',
      firstLine: 'I do not want to be difficult — your calls are carrying. Can we agree on booth use for longer conversations, or different hours for speakerphone?',
    },
    B2: {
      title: 'Norms conflict on hybrid floor',
      setting: 'Team culture clashes with concentration needs.',
      firstLine: 'We are misaligned on what open plan means — can we define quiet hours or a signal for deep work, and will you help enforce it peer to peer?',
    },
    C1: {
      title: 'Psychological safety vs productivity',
      setting: 'A popular teammate is the source of noise; politics matter.',
      firstLine: 'I need this framed as shared norms, not personal criticism — how do we protect collaboration energy without normalizing constant disruption, and what experiment can we try for two weeks?',
    },
    C2: {
      title: 'Executive floor etiquette dispute',
      setting: 'Visibility escalates minor friction; you reset leadership example.',
      firstLine: 'This became symbolic — what behavior signals we want from leaders in open space, what exceptions are defensible, and how do we avoid a policy memo that kills spontaneity?',
    },
  },
  {
    domain: 'work',
    slug: 'review-prep-chat',
    coachRole: 'HR partner',
    learnerRole: 'Employee',
    A1: {
      title: 'Review help',
      setting: 'HR helps you prepare for a work review.',
      firstLine: 'Hi. Your review is next week. What work do you want to talk about?',
    },
    A2: {
      title: 'Performance review prep',
      setting: 'You discuss what evidence to bring to a review.',
      firstLine: 'Before your review — what wins do you want highlighted, and where do you want growth feedback?',
    },
    B1: {
      title: 'Review narrative alignment',
      setting: 'You align on goals and evidence with HR before the manager conversation.',
      firstLine: 'Help me pressure-test your story — what outcomes you owned versus supported, metrics you can cite, and concerns you want aired constructively?',
    },
    B2: {
      title: 'Calibration awareness',
      setting: 'Ratings are competitive; you position without sounding defensive.',
      firstLine: 'What differentiates your impact from peers at your level, what stretch you took on, and where do you want the conversation to land on development versus compensation?',
    },
    C1: {
      title: 'Bias-aware review coaching',
      setting: 'Identity dynamics may affect perception; you prepare language.',
      firstLine: 'Where might your contributions be under-visible, what third-party validation helps, and how do you want to redirect if feedback drifts into style over substance?',
    },
    C2: {
      title: 'Executive promotion discussion',
      setting: 'Stakeholders disagree on readiness; you craft a principled case.',
      firstLine: 'What bar you are being held to implicitly versus explicitly, what risks sponsors are weighing, and what trade-off you propose if promotion is deferred — with timeline?',
    },
  },
  {
    domain: 'work',
    slug: 'remote-onboarding-call',
    coachRole: 'Onboarding buddy',
    learnerRole: 'New hire',
    A1: {
      title: 'First day call',
      setting: 'It is your first day at a new job from home.',
      firstLine: 'Welcome! What tools can you open? Do you see your email?',
    },
    A2: {
      title: 'Remote onboarding check',
      setting: 'A buddy helps you access systems on day one.',
      firstLine: 'Let us verify access — can you log into chat, VPN, and the HR portal, and tell me where you are stuck?',
    },
    B1: {
      title: 'Day-one remote setup',
      setting: 'You need a prioritized list to become productive quickly.',
      firstLine: 'I want a realistic first-week plan — what accounts matter most, who owns approvals, and what meetings you should not skip?',
    },
    B2: {
      title: 'Onboarding friction across time zones',
      setting: 'Delays cascade; you negotiate a workable ramp.',
      firstLine: 'What blockers are process versus tooling, what can async, and what synchronous touchpoints you need from your manager so you are not idle three days?',
    },
    C1: {
      title: 'Cultural assimilation remote',
      setting: 'Informal knowledge transfer is weak; you address it explicitly.',
      firstLine: 'What unwritten rules I should know, who actually decides things versus who appears to, and what network gaps put me at a disadvantage if we do not fix them early?',
    },
    C2: {
      title: 'Merger onboarding ambiguity',
      setting: 'Dual systems and loyalty questions; you navigate identity.',
      firstLine: 'Which norms survive the integration, where are we pretending alignment while competing internally, and what do you need from me to model constructive ambiguity?',
    },
  },
  {
    domain: 'work',
    slug: 'deadline-pushback',
    coachRole: 'Product manager',
    learnerRole: 'Engineer',
    A1: {
      title: 'Too much work',
      setting: 'Someone wants work very fast. You say it is hard.',
      firstLine: 'Hi. Friday is very fast for me. Can we change the date?',
    },
    A2: {
      title: 'Tight deadline',
      setting: 'You push back politely on an aggressive date.',
      firstLine: 'Friday is risky for quality — what can we cut from scope or move to a follow-up release?',
    },
    B1: {
      title: 'Scope versus date trade-off',
      setting: 'You negotiate what ships on the original milestone.',
      firstLine: 'I can hit Friday if we freeze requirements today and drop the analytics slice — which cut hurts the business less, and who approves it?',
    },
    B2: {
      title: 'Commitment engineering under sales pressure',
      setting: 'Commercial promises pre-empted technical reality.',
      firstLine: 'Help me map what was promised externally versus what is feasible — what narrative we give sales, what buffer we hide responsibly, and what governance stops this recurring?',
    },
    C1: {
      title: 'Organizational overcommitment',
      setting: 'You challenge systemic overload, not just this ticket.',
      firstLine: 'We are burning credibility — what portfolio decision you will defend to leadership, what you will stop starting, and what metric proves we are lying to ourselves about capacity?',
    },
    C2: {
      title: 'Pre-mortem before a flagship launch',
      setting: 'Careers ride on the date; you force explicit risk ownership.',
      firstLine: 'If this launches and fails, whose decision tree gets scrutinized — what are we shipping with known defects, who signs residual risk, and what kill criteria we will actually honor?',
    },
  },
  {
    domain: 'work',
    slug: 'cross-team-blocker',
    coachRole: 'Partner team lead',
    learnerRole: 'Project owner',
    A1: {
      title: 'Waiting on another team',
      setting: 'Your work waits for another team. You ask them.',
      firstLine: 'Hello. We need your API. When can you finish it?',
    },
    A2: {
      title: 'Dependency delay',
      setting: 'Another team blocks your milestone; you request a date.',
      firstLine: 'We are blocked on your schema change — what is realistic for delivery, and can we get a daily checkpoint until it lands?',
    },
    B1: {
      title: 'Unblocking a shared dependency',
      setting: 'Two teams share accountability; you clarify handoffs.',
      firstLine: 'I need a joint plan: your remaining tasks, our integration tests, and a single owner for cutover — what do you propose?',
    },
    B2: {
      title: 'Political dependency gridlock',
      setting: 'Priorities conflict; you seek escalation path.',
      firstLine: 'We are misaligned on priority — what your team owes versus what mine does, where the dispute should be decided, and what interim workaround protects users?',
    },
    C1: {
      title: 'Matrix organization stalemate',
      setting: 'Incentives misalign; you reframe shared OKRs.',
      firstLine: 'What outcome we both get graded on, what local optimization is hurting it, and what executive alignment you need me to help secure without making you look bad?',
    },
    C2: {
      title: 'Ecosystem partnership tension',
      setting: 'External partner and internal team blame each other.',
      firstLine: 'Separate narrative from obligation — what contract and what handshake actually govern behavior, what evidence each side has, and what joint steering body can decide without litigation vibes?',
    },
  },
  {
    domain: 'work',
    slug: 'customer-complaint-tier1',
    coachRole: 'Angry customer',
    learnerRole: 'Support agent',
    A1: {
      title: 'Angry customer',
      setting: 'A customer is unhappy on the phone.',
      firstLine: 'I am upset! My product is broken! What will you do?',
    },
    A2: {
      title: 'Handling a complaint',
      setting: 'A customer raises voice about a defect; you stay calm.',
      firstLine: 'I hear you — let us fix this. What is the product, when did it fail, and what do you want as a fair outcome?',
    },
    B1: {
      title: 'Escalated support call',
      setting: 'You de-escalate while gathering facts for a refund decision.',
      firstLine: 'I am sorry this happened — walk me through what you tried, what broke our promise, and whether replacement or refund gets you whole faster.',
    },
    B2: {
      title: 'Retention-risk complaint',
      setting: 'Social media threat is implied; you balance policy and brand.',
      firstLine: 'Help me understand public-facing risk, what you already posted, what remedy closes the loop privately, and what timeline you consider reasonable?',
    },
    C1: {
      title: 'Values clash with policy',
      setting: 'Customer cites fairness; policy is rigid; you interpret humanely.',
      firstLine: 'Where is policy failing your legitimate expectation, what precedent worries you if we say no, and what creative within-bounds fix signals we listened?',
    },
    C2: {
      title: 'Regulatory undertone complaint',
      setting: 'Legal language appears; you avoid admissions while repairing.',
      firstLine: 'What counsel advised you, what facts are undisputed, what remedy you seek that is not punitive, and how do we document resolution without creating liability theater?',
    },
  },
  {
    domain: 'work',
    slug: 'training-av-check',
    coachRole: 'Trainer',
    learnerRole: 'Participant',
    A1: {
      title: 'Training room',
      setting: 'A trainer checks if you can hear before a class.',
      firstLine: 'Hello. Can you hear me? Is your microphone on?',
    },
    A2: {
      title: 'Workshop tech check',
      setting: 'You join a training session; the host tests audio.',
      firstLine: 'Quick AV check — can you hear me clearly, and can you unmute and say your name?',
    },
    B1: {
      title: 'Hybrid training readiness',
      setting: 'Some people are remote; you confirm participation modes.',
      firstLine: 'We are hybrid today — confirm your camera policy, whether slides are visible, and if breakout rooms will work on your device.',
    },
    B2: {
      title: 'Facilitator under tool failure',
      setting: 'Platform glitches; you co-create a fallback.',
      firstLine: 'We lost screen share — what alternative channel works for you, how we preserve engagement, and whether we should pause versus push audio-only?',
    },
    C1: {
      title: 'Global audience accessibility',
      setting: 'Captions, language, and bandwidth vary; you negotiate norms.',
      firstLine: 'What accessibility needs we have not surfaced, what pace disadvantages non-native speakers, and what async supplement makes this fair without doubling your prep?',
    },
    C2: {
      title: 'Executive academy credibility',
      setting: 'VIP participants challenge format; you defend design.',
      firstLine: 'What skepticism about this format is valid, what learning science we are betting on, and what concession you will make without turning this into a passive webinar?',
    },
  },
  // --- Life (17) ---
  {
    domain: 'life',
    slug: 'pharmacy-counter',
    coachRole: 'Pharmacist',
    learnerRole: 'Customer',
    A1: {
      title: 'Pharmacy — medicine',
      setting: 'You need simple help at a pharmacy.',
      firstLine: 'Hello. I need medicine for a headache. Can you help me?',
    },
    A2: {
      title: 'Over-the-counter advice',
      setting: 'You ask about a mild symptom and suitable OTC options.',
      firstLine: 'I have allergy symptoms — what do you recommend that will not make me drowsy for work?',
    },
    B1: {
      title: 'Medication interaction check',
      setting: 'You take a regular prescription and need OTC guidance.',
      firstLine: 'I am on blood pressure medication — is this cough syrup safe with it, and what side effects should I watch for?',
    },
    B2: {
      title: 'Complex OTC triage',
      setting: 'Multiple products failed; you seek a structured recommendation.',
      firstLine: 'I tried two antihistamines without relief — given my history, what active ingredient should we try next, and when should I see a clinician instead?',
    },
    C1: {
      title: 'Guardian picking up prescription',
      setting: 'Consent and privacy intersect; you clarify responsibilities.',
      firstLine: 'I am picking up for my parent — what verification you need, what counseling you can share with me versus them, and how we handle dosage changes they may not remember?',
    },
    C2: {
      title: 'Cross-border prescription confusion',
      setting: 'Regulatory framing matters; you avoid unsafe assumptions.',
      firstLine: 'This was prescribed abroad — what equivalencies you can honor, what documentation closes liability, and what clinical red lines mean you must refuse despite urgency?',
    },
  },
  {
    domain: 'life',
    slug: 'bus-route-visitor',
    coachRole: 'Local passenger',
    learnerRole: 'Visitor',
    A1: {
      title: 'Which bus',
      setting: 'You are at a bus stop in a new city.',
      firstLine: 'Excuse me. I go to the museum. Is this the right bus?',
    },
    A2: {
      title: 'Transit directions',
      setting: 'You confirm route and stop with a stranger.',
      firstLine: 'Does the 12 stop here for Central Library, and do I need a transfer?',
    },
    B1: {
      title: 'Night service and safety',
      setting: 'You plan a return trip after an event.',
      firstLine: 'I need to get back after 11 — which routes still run, how frequent are they, and is there a safer stop if this one feels isolated?',
    },
    B2: {
      title: 'Disruption day travel',
      setting: 'A strike or detour changes plans; you adapt.',
      firstLine: 'Official apps conflict — what is actually running on this corridor, what workaround locals use, and how much buffer I should add?',
    },
    C1: {
      title: 'Accessibility needs on transit',
      setting: 'Mobility and anxiety interact; you ask for dignity-preserving options.',
      firstLine: 'I need step-free access and predictable crowding — which lines and times fit, what staff assistance exists, and how do I avoid being stranded if elevators fail?',
    },
    C2: {
      title: 'City mobility equity debate',
      setting: 'A community meeting discusses service cuts; you argue a case.',
      firstLine: 'Frame who bears the cost of this cut, what second-order effects on night-shift workers you are ignoring, and what revenue or priority shift would preserve coverage without magical thinking?',
    },
  },
  {
    domain: 'life',
    slug: 'neighbor-noise',
    coachRole: 'Neighbor',
    learnerRole: 'Resident',
    A1: {
      title: 'Loud neighbor',
      setting: 'Your neighbor is loud at night. You knock and speak simply.',
      firstLine: 'Hi. Sorry — the music is very loud. Can you make it quieter, please?',
    },
    A2: {
      title: 'Apartment noise',
      setting: 'You ask a neighbor to lower volume after hours.',
      firstLine: 'Hey — I have an early morning tomorrow; could you turn the bass down after 10?',
    },
    B1: {
      title: 'Noise pattern conversation',
      setting: 'Repeated issues; you seek a practical agreement.',
      firstLine: 'This has been a few Tuesdays in a row — can we agree on quiet hours or moving speakers off the shared wall?',
    },
    B2: {
      title: 'Noise and lease norms',
      setting: 'Relationship is strained; you reference building rules lightly.',
      firstLine: 'I want to avoid involving management — what schedule works for your gatherings, and can we text if it spikes so I do not have to knock cold?',
    },
    C1: {
      title: 'Cultural difference on noise',
      setting: 'Interpretations of courtesy differ; you bridge without accusing.',
      firstLine: 'Help me understand your norms versus mine — what you consider reasonable hours, what you did not realize carried, and what small change would feel respectful on both sides?',
    },
    C2: {
      title: 'Mediation-ready neighbor dispute',
      setting: 'HOA may intervene; you propose a durable pact.',
      firstLine: 'We are one complaint away from escalation — what measurable standard we both accept, what exceptions for holidays, and what third-party process you prefer if we slip?',
    },
  },
  {
    domain: 'life',
    slug: 'gym-membership',
    coachRole: 'Gym front desk',
    learnerRole: 'Member',
    A1: {
      title: 'Gym — freeze',
      setting: 'You will travel. You ask about your gym.',
      firstLine: 'Hello. I travel next month. Can I stop my gym for one month?',
    },
    A2: {
      title: 'Membership pause',
      setting: 'You inquire about freezing membership for travel.',
      firstLine: 'I will be away six weeks — do you offer a freeze, and what is the fee or notice period?',
    },
    B1: {
      title: 'Contract terms for injury',
      setting: 'You hurt your knee; you need billing relief.',
      firstLine: 'My doctor advised no squats for two months — what medical documentation you need to pause billing, and how reinstatement works?',
    },
    B2: {
      title: 'Membership dispute after move',
      setting: 'Location closed; you negotiate transfer or exit.',
      firstLine: 'My home club shut — what nearest option honors my rate, what commute is reasonable under your policy, and if neither works what exit path exists?',
    },
    C1: {
      title: 'Predatory clause challenge',
      setting: 'Auto-renew surprised you; you seek principled resolution.',
      firstLine: 'What notice you claim you sent versus what I received, what good-faith interpretation regulators expect here, and what resolution avoids small-claims but respects my time?',
    },
    C2: {
      title: 'Class-action adjacent pressure',
      setting: 'Public thread names the chain; manager has latitude.',
      firstLine: 'What systemic practice you will admit, what remediation batch you are authorized to offer, and what governance change you will document so this is not another PR cycle?',
    },
  },
  {
    domain: 'life',
    slug: 'landlord-repair',
    coachRole: 'Landlord',
    learnerRole: 'Tenant',
    A1: {
      title: 'Broken heat',
      setting: 'Your apartment is cold. You call the landlord.',
      firstLine: 'Hello. My heat is broken. It is very cold. Please help.',
    },
    A2: {
      title: 'Repair request',
      setting: 'You report a maintenance issue in your rental.',
      firstLine: 'The bathroom fan stopped working and moisture is building — can you send someone this week?',
    },
    B1: {
      title: 'Habitability timeline',
      setting: 'Heat fails in winter; you need a clear fix window.',
      firstLine: 'It has been three nights without reliable heat — what is your plan, who is the contractor, and what temporary remedy can you authorize tonight?',
    },
    B2: {
      title: 'Repair vs rent withholding',
      setting: 'Law is unclear locally; you negotiate without threats.',
      firstLine: 'I need this documented — what entry notice you will give, what standard you consider complete, and how we handle rent if the window slips again?',
    },
    C1: {
      title: 'Retaliation-sensitive tenancy',
      setting: 'You fear pushback for complaining; you seek professional tone.',
      firstLine: 'I want a paper trail that helps both of us — what timeline you commit to, what communication channel you prefer, and how we de-escalate if neighbors are also affected?',
    },
    C2: {
      title: 'Portfolio landlord leverage',
      setting: 'Scale asymmetry; you argue for systemic accountability.',
      firstLine: 'This pattern matches other units — what root cause in your vendor chain, what audit you will run, and what concession makes me confident this is not perpetual churn?',
    },
  },
  {
    domain: 'life',
    slug: 'clinic-symptoms',
    coachRole: 'Clinic nurse',
    learnerRole: 'Patient',
    A1: {
      title: 'Doctor office',
      setting: 'A nurse asks why you came to the clinic.',
      firstLine: 'Hello. Why are you here today? Where does it hurt?',
    },
    A2: {
      title: 'Triage questions',
      setting: 'You describe basic symptoms at a walk-in clinic.',
      firstLine: 'What is bothering you most today, how long has it lasted, and any fever?',
    },
    B1: {
      title: 'Structured symptom history',
      setting: 'You prepare for a clinician with clearer chronology.',
      firstLine: 'Walk me through onset, what makes it better or worse, medications you took, and anything similar before?',
    },
    B2: {
      title: 'Chronic condition flare',
      setting: 'You differentiate new red flags from baseline.',
      firstLine: 'I have a known condition — what changed this episode versus my usual flare, and what tests I should insist on versus wait out?',
    },
    C1: {
      title: 'Advocacy under time pressure',
      setting: 'You feel dismissed; you stay evidence-based.',
      firstLine: 'What differential you are considering, what data would change your plan, and how do I request a second opinion without poisoning this relationship?',
    },
    C2: {
      title: 'Cross-disciplinary care coordination',
      setting: 'Specialists disagree; you force a synthesis.',
      firstLine: 'What conflict exists between recommendations, what risk each stance underestimates, and what decision framework gets me to one accountable path this week?',
    },
  },
  {
    domain: 'life',
    slug: 'restaurant-allergy',
    coachRole: 'Server',
    learnerRole: 'Diner',
    A1: {
      title: 'Food allergy',
      setting: 'You order food and you have an allergy.',
      firstLine: 'Hi. I cannot eat nuts. Is this dish safe for me?',
    },
    A2: {
      title: 'Allergy check at restaurant',
      setting: 'You ask about ingredients before ordering.',
      firstLine: 'I have a shellfish allergy — does the kitchen share fryers or sauces I should worry about?',
    },
    B1: {
      title: 'Serious allergy order',
      setting: 'You need staff to confirm with kitchen, not guess.',
      firstLine: 'I carry epinephrine — please confirm with the chef whether this dish contains dairy or traces, and what alternative you recommend if not.',
    },
    B2: {
      title: 'Cross-contamination risk',
      setting: 'Menu is ambiguous; you push for clarity without drama.',
      firstLine: 'I need a conservative read — what prep surfaces touch nuts, what the kitchen can realistically segregate tonight, and what off-menu simple plate is safest?',
    },
    C1: {
      title: 'Restaurant liability conversation',
      setting: 'A prior incident makes you vigilant; you stay collaborative.',
      firstLine: 'What protocol you follow for anaphylaxis risk, who signs off on exceptions, and how you document what you told me if something goes wrong?',
    },
    C2: {
      title: 'Group dinner with divergent dietary ethics',
      setting: 'Host pressure meets medical need; you navigate gracefully.',
      firstLine: 'What compromise preserves my safety without making the table about me, what the kitchen can batch separately, and how do we reset if someone pushes “just a bite”?',
    },
  },
  {
    domain: 'life',
    slug: 'lost-wallet-cafe',
    coachRole: 'Cafe manager',
    learnerRole: 'Customer',
    A1: {
      title: 'Lost wallet',
      setting: 'You think you lost your wallet in a cafe.',
      firstLine: 'Hello. I lost my wallet. Did you find a black wallet?',
    },
    A2: {
      title: 'Lost item inquiry',
      setting: 'You ask staff if anything was turned in.',
      firstLine: 'I think I left a brown wallet near the window — did anyone hand one in this morning?',
    },
    B1: {
      title: 'Lost property process',
      setting: 'You need timing and verification steps.',
      firstLine: 'What is your lost-and-found policy, whether cameras can confirm timing, and what ID you need before you release an item to me?',
    },
    B2: {
      title: 'High-value loss emotions',
      setting: 'You are stressed; you cooperate with process.',
      firstLine: 'Cards are frozen — help me reconstruct when I paid, whether staff saw it after, and what police report you recommend if it was stolen not lost?',
    },
    C1: {
      title: 'Good-faith dispute over found item',
      setting: 'Another customer claims the same wallet; you navigate.',
      firstLine: 'What evidence each party has, what neutral verification you will use, and how you avoid publicly shaming someone while resolving this?',
    },
    C2: {
      title: 'Reputation risk for small business',
      setting: 'Social post alleges theft by staff; owner engages.',
      firstLine: 'What footage policy you can share legally, what statement protects your staff without sounding defensive, and what restorative step rebuilds trust with regulars?',
    },
  },
  {
    domain: 'life',
    slug: 'school-parent-night',
    coachRole: 'Teacher',
    learnerRole: 'Parent',
    A1: {
      title: 'School meeting',
      setting: 'You meet your child’s teacher.',
      firstLine: 'Hello. How is my child in class? Are they happy?',
    },
    A2: {
      title: 'Parent-teacher chat',
      setting: 'You ask about behavior and reading at school.',
      firstLine: 'How is she participating in group work, and what should we practice at home?',
    },
    B1: {
      title: 'Parent night follow-up',
      setting: 'You discuss a mild learning concern constructively.',
      firstLine: 'I noticed math confidence dropped — what you see in class, what supports exist, and how we align without over-scheduling her?',
    },
    B2: {
      title: 'IEP-adjacent conversation',
      setting: 'Formal plan not yet in place; you probe options.',
      firstLine: 'What accommodations are informal versus documented, what timeline for evaluation if needed, and how do we track progress with shared metrics?',
    },
    C1: {
      title: 'Cultural mismatch with school norms',
      setting: 'Discipline philosophy differs; you seek partnership.',
      firstLine: 'Where your expectations clash with our home norms, what outcome you are optimizing for, and what language in emails reduces friction for my child in the middle?',
    },
    C2: {
      title: 'Gifted-and-struggling paradox',
      setting: 'Complex profile; you push for nuanced plan.',
      firstLine: 'What strengths mask deficits, what boredom triggers behavior, and what acceleration versus scaffolding trade-off you will defend with administration?',
    },
  },
  {
    domain: 'life',
    slug: 'bank-card-travel',
    coachRole: 'Bank phone agent',
    learnerRole: 'Customer',
    A1: {
      title: 'Card blocked',
      setting: 'Your bank card does not work abroad.',
      firstLine: 'Hello. My card does not work. I am in another country. Help.',
    },
    A2: {
      title: 'Travel card block',
      setting: 'Fraud lock triggered; you verify identity.',
      firstLine: 'I am traveling and my card declined — can you verify my account and lift the hold?',
    },
    B1: {
      title: 'Fraud alert triage abroad',
      setting: 'You need cash access urgently.',
      firstLine: 'What transactions triggered the block, what security questions you need, and can you raise my ATM limit temporarily once cleared?',
    },
    B2: {
      title: 'Multi-factor failure on the road',
      setting: 'SIM and app access are messy; you find a path.',
      firstLine: 'I cannot receive SMS — what alternate verification exists, what branch protocol applies internationally, and what provisional access you can grant?',
    },
    C1: {
      title: 'Regulatory hold nuance',
      setting: 'Block is compliance-related; answers are limited.',
      firstLine: 'What you can disclose versus cannot, what timeline resolution typically takes, and what documentation I should carry to satisfy the next review?',
    },
    C2: {
      title: 'Political risk banking',
      setting: 'Sanctions or jurisdiction questions arise; you stay calm.',
      firstLine: 'What rule triggered automated review, what innocent activity pattern mimics risk, and what escalation path exists without me stranded for weeks?',
    },
  },
  {
    domain: 'life',
    slug: 'haircut-instructions',
    coachRole: 'Hair stylist',
    learnerRole: 'Client',
    A1: {
      title: 'Haircut words',
      setting: 'You want a simple haircut.',
      firstLine: 'Hi. Please cut my hair shorter. Not too short. Thank you.',
    },
    A2: {
      title: 'Salon instructions',
      setting: 'You describe length and style in basic terms.',
      firstLine: 'I want trim about two centimeters off, keep the layers, and tidy the neckline.',
    },
    B1: {
      title: 'Specific style reference',
      setting: 'You bring a photo and negotiate feasibility.',
      firstLine: 'This photo is the vibe — my hair is finer; what is realistic, what maintenance it needs, and what if I do not style it daily?',
    },
    B2: {
      title: 'Color history complexity',
      setting: 'Past dye affects options; you seek honest advice.',
      firstLine: 'I box-dyed six months ago — what damage you see, what color correction timeline you recommend, and what price band am I in?',
    },
    C1: {
      title: 'Identity-sensitive appearance change',
      setting: 'You discuss gender-affirming or cultural sensitivity.',
      firstLine: 'What language avoids assumptions, what privacy I need in a busy salon, and how do you handle a style that may read differently in my workplace?',
    },
    C2: {
      title: 'Public figure discretion',
      setting: 'Recognition risk; you negotiate privacy and photos.',
      firstLine: 'What policy on social posts, how we handle walk-ins recognizing me, and what fee structure reflects after-hours privacy?',
    },
  },
  {
    domain: 'life',
    slug: 'supermarket-return',
    coachRole: 'Store clerk',
    learnerRole: 'Shopper',
    A1: {
      title: 'Return food',
      setting: 'You want to return something you bought.',
      firstLine: 'Hello. I want to return this. It is bad. Here is my receipt.',
    },
    A2: {
      title: 'Grocery return',
      setting: 'A product is spoiled; you ask for exchange.',
      firstLine: 'This milk smells off before the date — can I swap it or get a refund with this receipt?',
    },
    B1: {
      title: 'Return policy edge case',
      setting: 'Packaging opened; you plead reasonableness.',
      firstLine: 'I opened it before noticing mold — what proof you need, whether store credit is available, and how you handle allergens if kids ate some?',
    },
    B2: {
      title: 'Batch quality issue',
      setting: 'You suspect wider problem; you escalate calmly.',
      firstLine: 'Three items from the same brand failed — should this be logged centrally, what batch codes help, and what goodwill gesture reflects repeat customer status?',
    },
    C1: {
      title: 'Food safety advocacy',
      setting: 'You want accountability without vilifying frontline staff.',
      firstLine: 'What upstream check failed, what you will pull from shelves tonight, and how you communicate to customers who already purchased?',
    },
    C2: {
      title: 'Supplier chain accountability',
      setting: 'Regional manager is present; you argue systemic fix.',
      firstLine: 'What root cause analysis you will run, what transparency to regulators if needed, and what compensation framework avoids case-by-case lottery?',
    },
  },
  {
    domain: 'life',
    slug: 'park-directions',
    coachRole: 'Park ranger',
    learnerRole: 'Visitor',
    A1: {
      title: 'Park path',
      setting: 'You are in a park and need simple directions.',
      firstLine: 'Hello. Where is the lake? Is it far to walk?',
    },
    A2: {
      title: 'Trail information',
      setting: 'You ask about difficulty and time for a hike.',
      firstLine: 'Is the blue loop okay for beginners, and how long does it usually take?',
    },
    B1: {
      title: 'Weather and safety',
      setting: 'Clouds roll in; you adjust plans.',
      firstLine: 'If lightning risk rises, what shelters exist, what turnaround point you recommend, and how fast conditions change at elevation here?',
    },
    B2: {
      title: 'Wildlife encounter protocol',
      setting: 'You saw signs of bears; you want guidance.',
      firstLine: 'What recent sightings, what behavior actually reduces risk versus myth, and should I reroute with kids?',
    },
    C1: {
      title: 'Conservation tension with recreation',
      setting: 'Crowds damage habitat; you engage ethically.',
      firstLine: 'What carrying capacity data you track, what visitor behavior you need to change, and how enforcement pairs with education so it does not feel punitive?',
    },
    C2: {
      title: 'Climate-stressed ecosystem',
      setting: 'Fire season policy shifts; you seek nuanced guidance.',
      firstLine: 'What long-term change you are managing, what trade-off between access and protection you are making, and how should advocates help without political theater?',
    },
  },
  {
    domain: 'life',
    slug: 'dentist-reschedule',
    coachRole: 'Dental receptionist',
    learnerRole: 'Patient',
    A1: {
      title: 'Dentist time',
      setting: 'You need another day for the dentist.',
      firstLine: 'Hello. I cannot come Tuesday. Can I come Friday?',
    },
    A2: {
      title: 'Reschedule appointment',
      setting: 'You move a dental cleaning.',
      firstLine: 'I need to shift next week’s cleaning — what openings do you have after 4 p.m.?',
    },
    B1: {
      title: 'Procedure prep reschedule',
      setting: 'Imaging timing affects treatment plan.',
      firstLine: 'If I move the prep appointment, does that push the procedure date, and what fasting rules still apply?',
    },
    B2: {
      title: 'Insurance window pressure',
      setting: 'Benefits reset soon; you optimize slots.',
      firstLine: 'What latest date still clears insurance this cycle, what codes you will bill, and what out-of-pocket if we slip to January?',
    },
    C1: {
      title: 'Dental anxiety negotiation',
      setting: 'You need sedation options discussed plainly.',
      firstLine: 'What sedation tiers you offer, what risk profile I fit, and what consent language I should understand before agreeing?',
    },
    C2: {
      title: 'Overtreatment skepticism',
      setting: 'Second opinion culture; you probe recommendations.',
      firstLine: 'What evidence standard supports this intervention now versus watchful waiting, what conflicts of interest exist in-house, and how do you document if I defer?',
    },
  },
  {
    domain: 'life',
    slug: 'vet-visit',
    coachRole: 'Veterinarian',
    learnerRole: 'Pet owner',
    A1: {
      title: 'Pet sick',
      setting: 'Your pet is not well. You see the vet.',
      firstLine: 'Hello. My dog is sick. She will not eat. Can you help?',
    },
    A2: {
      title: 'Vet check-up',
      setting: 'You describe symptoms and diet changes.',
      firstLine: 'He has been vomiting since yesterday — still drinking water — should I bring him in today?',
    },
    B1: {
      title: 'Treatment options and cost',
      setting: 'You weigh tests versus watchful waiting.',
      firstLine: 'What differential you consider likely, what diagnostics change the plan, and what ballpark cost before we proceed?',
    },
    B2: {
      title: 'Chronic condition maintenance',
      setting: 'Meds stopped working as well.',
      firstLine: 'What trend lines concern you in her labs, what titration strategy you recommend, and what side effects mean we stop?',
    },
    C1: {
      title: 'End-of-life care framing',
      setting: 'Quality of life is ambiguous; you seek clarity.',
      firstLine: 'What objective pain signals you watch, what timeline honesty you can give, and what hospice-style supports exist at home?',
    },
    C2: {
      title: 'Ethical tension in expensive care',
      setting: 'Finances and love collide; you navigate without shame.',
      firstLine: 'What minimum care preserves dignity, what optional heroic measures have low success, and how do we decide without guilt-tripping family members?',
    },
  },
  {
    domain: 'life',
    slug: 'phone-plan-shop',
    coachRole: 'Mobile shop staff',
    learnerRole: 'Customer',
    A1: {
      title: 'Phone plan',
      setting: 'You buy a phone plan. You need simple help.',
      firstLine: 'Hello. I need a phone plan. I use internet every day. What is good?',
    },
    A2: {
      title: 'SIM and data',
      setting: 'You compare two prepaid options.',
      firstLine: 'I need about 20 GB and some international minutes — what plan fits without a contract?',
    },
    B1: {
      title: 'Family plan trade-offs',
      setting: 'Multiple lines; you clarify throttling rules.',
      firstLine: 'What happens after the cap, whether hotspot is included, and what roaming charges look like in region B?',
    },
    B2: {
      title: 'Contract fine print',
      setting: 'Promotional price expires; you probe renewal.',
      firstLine: 'What price after month twelve, what exit fees, and what network priority differences matter for my work VPN?',
    },
    C1: {
      title: 'Privacy versus carrier bundles',
      setting: 'You question data resale and DNS.',
      firstLine: 'What data you monetize, what opt-outs exist without degrading service, and what technical setup reduces tracking on-device?',
    },
    C2: {
      title: 'Regulatory roaming dispute',
      setting: 'Bill shock after travel; you argue consumer protection.',
      firstLine: 'What disclosure you claim versus what UX showed, what good-faith adjustment policy exists, and what ombudsman path you expect if we disagree?',
    },
  },
  {
    domain: 'life',
    slug: 'airbnb-checkin',
    coachRole: 'Host',
    learnerRole: 'Guest',
    A1: {
      title: 'Rental key',
      setting: 'You arrive at a short rental.',
      firstLine: 'Hello. I am here. Where is the key? The code does not work.',
    },
    A2: {
      title: 'Check-in problem',
      setting: 'Lockbox code fails; you message the host.',
      firstLine: 'We are at the door — the code you sent does not open the box; can you confirm or send someone?',
    },
    B1: {
      title: 'Listing mismatch',
      setting: 'Photos showed amenities missing.',
      firstLine: 'The Wi-Fi is unusable for work — what fix timeline you commit to, and what partial refund policy applies if it spans the stay?',
    },
    B2: {
      title: 'Neighborhood safety surprise',
      setting: 'Noise and access differ from description.',
      firstLine: 'What you knew about night noise, what disclosure you consider adequate, and how we document this for platform support?',
    },
    C1: {
      title: 'Host-guest power imbalance',
      setting: 'Threat of bad review flies; you de-escalate.',
      firstLine: 'What remedy restores fairness without retaliation risk, what platform rules govern review coercion, and what neutral evidence we should collect now?',
    },
    C2: {
      title: 'Short-term rental regulation edge',
      setting: 'Building policy may prohibit; you clarify liability.',
      firstLine: 'What legal risk you carry versus me as guest, what insurance gaps exist, and what exit with minimum harm if authorities intervene?',
    },
  },
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Lowercase first letter so roles read naturally in speech ("the receptionist"). */
function lowerRoleForSpeech(role) {
  const s = String(role ?? '').trim();
  if (!s) return 'partner';
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Prefix: scene + who plays whom (user-approved wording), then em dash + in-character opening.
 */
function composeFirstLineWithSetup({ title, setting, coachRole, learnerRole, rawFirstLine }) {
  const scene = `Scene: ${String(title).trim()}. ${String(setting).trim()}`.replace(/\s+/g, ' ').trim();
  const bridge = `I'll start as the ${lowerRoleForSpeech(coachRole)}; you reply as the ${lowerRoleForSpeech(learnerRole)}.`;
  return `${scene} ${bridge} — ${String(rawFirstLine).trim()}`;
}

function buildScenarios() {
  const scenarios = [];
  let workIdx = 0;
  let lifeIdx = 0;

  for (const arch of ARCHETYPES) {
    const domainPrefix = arch.domain === 'work' ? 'w' : 'l';
    const idx = arch.domain === 'work' ? ++workIdx : ++lifeIdx;

    for (const level of LEVELS) {
      const pack = arch[level];
      if (!pack) throw new Error(`Missing ${level} in ${arch.slug}`);
      const id = `${level.toLowerCase()}-${domainPrefix}-${pad2(idx)}`;
      const row = {
        id,
        level,
        domain: arch.domain,
        title: pack.title,
        setting: pack.setting,
        coachRole: arch.coachRole,
        learnerRole: arch.learnerRole,
        firstLine: composeFirstLineWithSetup({
          title: pack.title,
          setting: pack.setting,
          coachRole: arch.coachRole,
          learnerRole: arch.learnerRole,
          rawFirstLine: pack.firstLine,
        }),
      };
      if (pack.learnerGoals) row.learnerGoals = pack.learnerGoals;
      scenarios.push(row);
    }
  }

  if (workIdx !== 18) throw new Error(`Expected 18 work archetypes, got ${workIdx}`);
  if (lifeIdx !== 17) throw new Error(`Expected 17 life archetypes, got ${lifeIdx}`);
  if (scenarios.length !== 35 * 6) throw new Error(`Expected 210 scenarios, got ${scenarios.length}`);

  return scenarios;
}

const scenarios = buildScenarios();
const doc = {
  schemaVersion: 2,
  description:
    '35 scenarios per CEFR level: 18 work + 17 life. Each firstLine: brief scene + "I\'ll start as the …; you reply as the …." — then the in-character opening. Server picks randomly by level.',
  scenarios,
};

writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
// eslint-disable-next-line no-console
console.error(`Wrote ${scenarios.length} scenarios to ${OUT}`);
