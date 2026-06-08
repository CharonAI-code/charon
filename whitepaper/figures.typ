#let border = rgb("#222222")
#let faint = rgb("#f6f6f6")
#let pass = rgb("#e9f7ef")
#let pause = rgb("#fff4df")
#let deny = rgb("#fdeaea")
#let ink = rgb("#111111")
#let muted = rgb("#555555")

#let figure-title(n, title, caption) = [
  #text(size: 9pt, weight: "bold")[Figure #n. #title]
  #v(3pt)
  #text(size: 7.5pt, fill: muted)[#caption]
  #v(8pt)
]

#let boxcell(title, body, fill: white, width: 100%) = block(
  width: width,
  inset: 8pt,
  stroke: 0.6pt + border,
  fill: fill,
  radius: 1pt,
)[
  #set par(justify: false)
  #align(left)[
    #text(size: 8.5pt, weight: "bold")[#title]
    #v(3pt)
    #text(size: 7.3pt)[#body]
  ]
]

#let smallcell(title, body, fill: white) = boxcell(title, body, fill: fill)

#let arrow(label: "") = align(center + horizon)[
  #text(size: 8pt, fill: muted)[->]
  #if label != "" [
    #linebreak()
    #text(size: 6.4pt, fill: muted)[#label]
  ]
]

#let down(label: "") = align(center)[
  #text(size: 8pt, fill: muted)[|]
  #linebreak()
  #text(size: 8pt, fill: muted)[v]
  #if label != "" [
    #linebreak()
    #text(size: 6.4pt, fill: muted)[#label]
  ]
]

#let fig-action-boundary() = [
  #figure-title(
    1,
    "Agent Action Boundary",
    "Charon evaluates a requested action before the operating system, tool, file, network target, or credential is touched.",
  )
  #table(
    columns: (1.2fr, 0.28fr, 1.2fr, 0.28fr, 1.2fr, 0.28fr, 1.2fr),
    stroke: none,
    inset: 0pt,
    align: center + horizon,
    boxcell("Agent runtime", "Produces an attempted action such as a command, tool call, file read, or network request."),
    arrow(label: "request"),
    boxcell("Adapter", "Canonicalizes the attempted action into a structured request. It does not execute it."),
    arrow(label: "action"),
    boxcell("Charon gate", "Loads policy, identity, and context. Returns PASS, PAUSE, or DENY."),
    arrow(label: "verdict"),
    boxcell("Machine boundary", "Only PASS reaches the real executor. PAUSE and DENY do not launch the action."),
  )
  #v(10pt)
  #table(
    columns: (1fr, 1fr, 1fr),
    stroke: 0.5pt + border,
    inset: 7pt,
    align: left,
    [#text(weight: "bold")[PASS] #linebreak() Action satisfies policy and may execute.],
    [#text(weight: "bold")[PAUSE] #linebreak() Action is reviewable risk and enters the queue.],
    [#text(weight: "bold")[DENY] #linebreak() Action violates policy and is blocked before launch.],
  )
]

#let fig-threat-surface() = [
  #figure-title(
    2,
    "Agent Threat Surface",
    "The critical risk is not only model output. It is the path from untrusted context into external side effects.",
  )
  #table(
    columns: (1fr, 0.22fr, 1fr, 0.22fr, 1fr),
    stroke: none,
    inset: 0pt,
    align: center + horizon,
    boxcell("Untrusted context", "Issues, web pages, docs, chats, tool descriptions, package metadata, retrieved files."),
    arrow(label: "influences"),
    boxcell("Model planning", "The model selects an action under probabilistic reasoning and changing context."),
    arrow(label: "requests"),
    boxcell("Tool/action layer", "Commands, file access, environment variables, network calls, deploys, API mutations."),
  )
  #v(10pt)
  #table(
    columns: (1fr, 1fr, 1fr),
    stroke: 0.5pt + border,
    inset: 7pt,
    [#text(weight: "bold")[Instruction bypass] #linebreak() Prompt injection can steer the requested action.],
    [#text(weight: "bold")[Authority confusion] #linebreak() Agents can inherit ambient credentials or broad tool access.],
    [#text(weight: "bold")[Hidden side effect] #linebreak() The final answer may look normal after an unsafe action was requested.],
  )
  #v(8pt)
  #boxcell("Charon placement", "The enforcement point is between the requested action and the side effect, not inside the model response.", fill: faint)
]

#let fig-decision-flow() = [
  #figure-title(
    3,
    "Charon Decision Flow",
    "A requested action is normalized, evaluated, and either executed, queued, or refused. Every branch writes a receipt.",
  )
  #table(
    columns: (1fr, 0.22fr, 1fr, 0.22fr, 1fr),
    stroke: none,
    inset: 0pt,
    align: center + horizon,
    boxcell("1. Request", "Adapter submits action: type, command/tool, arguments, cwd, runtime metadata."),
    arrow(),
    boxcell("2. Normalize", "Charon creates a deterministic representation used for policy checks and hashing."),
    arrow(),
    boxcell("3. Evaluate", "Policy engine checks action rules, file paths, env exposure, network targets, and output risks."),
  )
  #v(8pt)
  #down(label: "verdict")
  #v(4pt)
  #table(
    columns: (1fr, 1fr, 1fr),
    stroke: 0.5pt + border,
    inset: 8pt,
    align: left,
    [#block(fill: pass, inset: 6pt)[#text(weight: "bold")[PASS] #linebreak() Scrub environment, execute command, capture exit code, write receipt.]],
    [#block(fill: pause, inset: 6pt)[#text(weight: "bold")[PAUSE] #linebreak() Write signed queue item, wait for explicit approval or rejection, write receipt.]],
    [#block(fill: deny, inset: 6pt)[#text(weight: "bold")[DENY] #linebreak() Do not launch the action, record reason and trace, write receipt.]],
  )
]

#let fig-policy-surface() = [
  #figure-title(
    4,
    "Policy Surface",
    "Charon policy is not a prompt. It is structured control over the action surfaces that produce machine effects.",
  )
  #table(
    columns: (1.1fr, 2.1fr, 1.4fr),
    stroke: 0.45pt + border,
    inset: 6pt,
    align: left,
    [#text(weight: "bold")[Surface]], [#text(weight: "bold")[What is checked]], [#text(weight: "bold")[Example decision]],
    [Command], [Executable plus arguments after canonicalization.], [`npm publish` -> DENY],
    [File], [Requested paths inferred from command and structured tool input.], [`read:.env` -> DENY],
    [Environment], [Names exposed to the child process; secret values are never stored.], [`GITHUB_TOKEN` -> withheld],
    [Network], [Hosts or URLs requested by action text or tool input.], [`webhook.site` -> DENY],
    [Release action], [Operations that mutate public state or production state.], [`git push` -> PAUSE],
    [Output], [Secret-like output is redacted and can convert PASS into DENY.], [`github_pat_...` -> redacted],
  )
]

#let fig-receipt-anatomy() = [
  #figure-title(
    5,
    "Receipt Anatomy",
    "A receipt is the durable evidence for one Charon decision. It binds action, verdict, policy, identity, and trace.",
  )
  #table(
    columns: (1fr, 1fr),
    stroke: 0.5pt + border,
    inset: 7pt,
    align: left,
    [#text(weight: "bold")[Action fields] #linebreak() command, cwd, runtime metadata, adapter metadata],
    [#text(weight: "bold")[Decision fields] #linebreak() verdict, reason, exit code, startedAt, endedAt],
    [#text(weight: "bold")[Policy binding] #linebreak() policyHash over normalized policy controls and bounds],
    [#text(weight: "bold")[Boundary trace] #linebreak() matched action rule, file result, network result, secret result],
    [#text(weight: "bold")[Redaction record] #linebreak() commandRedactions, reasonRedactions, output redactions],
    [#text(weight: "bold")[Proof fields] #linebreak() receipt signature, identity action hash, identity signature],
  )
  #v(8pt)
  #boxcell("Important constraint", "Receipts should prove what Charon saw and decided. They should not store secret values.", fill: faint)
]

#let fig-verification-flow() = [
  #figure-title(
    6,
    "Signed Receipt Verification",
    "Verification recomputes hashes and checks signatures. Tampering with the receipt body or identity-bound action breaks verification.",
  )
  #table(
    columns: (1fr, 0.22fr, 1fr, 0.22fr, 1fr),
    stroke: none,
    inset: 0pt,
    align: center + horizon,
    boxcell("Receipt body", "All receipt fields except the receipt signature."),
    arrow(label: "hash"),
    boxcell("Receipt signature", "HMAC over the receipt body using the local receipt key."),
    arrow(label: "check"),
    boxcell("Receipt valid", "Body was not changed after Charon wrote it."),
  )
  #v(10pt)
  #table(
    columns: (1fr, 0.22fr, 1fr, 0.22fr, 1fr),
    stroke: none,
    inset: 0pt,
    align: center + horizon,
    boxcell("Identity payload", "command, cwd, policyHash, verdict, trace, meta, createdAt."),
    arrow(label: "hash"),
    boxcell("Identity proof", "actionHash plus signature from local Charon identity key."),
    arrow(label: "check"),
    boxcell("Identity valid", "The decision is bound to the recorded local agent identity."),
  )
]

#let fig-before-after() = [
  #figure-title(
    7,
    "Before And After Charon",
    "Charon changes the execution shape from direct tool access to mediated action access with explicit evidence.",
  )
  #table(
    columns: (1fr, 1fr),
    stroke: 0.5pt + border,
    inset: 8pt,
    align: left,
    [
      #text(weight: "bold")[Without Charon]
      #v(6pt)
      Agent runtime -> tools -> machine side effects
      #v(6pt)
      #text(size: 7.3pt)[Controls are usually prompts, framework allowlists, broad credentials, and post-hoc logs.]
    ],
    [
      #text(weight: "bold")[With Charon]
      #v(6pt)
      Agent runtime -> adapter -> Charon gate -> PASS / PAUSE / DENY -> receipt
      #v(6pt)
      #text(size: 7.3pt)[Controls are evaluated before launch, risky actions queue, denied actions do not execute, and decisions are verifiable.]
    ],
  )
  #v(10pt)
  #table(
    columns: (1fr, 1fr, 1fr),
    stroke: 0.5pt + border,
    inset: 7pt,
    [#text(weight: "bold")[Before launch] #linebreak() policy evaluation],
    [#text(weight: "bold")[At decision] #linebreak() queue or execution],
    [#text(weight: "bold")[After decision] #linebreak() signed receipt],
  )
]
