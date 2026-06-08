#import "figures.typ": *

#set page(
  paper: "us-letter",
  margin: (x: 0.72in, y: 0.7in),
)
#set text(
  font: "New Computer Modern",
  size: 10pt,
  fill: ink,
)
#set par(justify: false)

#align(center)[
  #text(size: 15pt, weight: "bold")[CHARON WHITEPAPER FIGURES]
  #v(4pt)
  #text(size: 8pt, fill: muted)[Technical figure draft for runtime boundary enforcement]
]

#v(18pt)

#fig-action-boundary()

#pagebreak()
#fig-threat-surface()

#pagebreak()
#fig-decision-flow()

#pagebreak()
#fig-policy-surface()

#pagebreak()
#fig-receipt-anatomy()

#pagebreak()
#fig-verification-flow()

#pagebreak()
#fig-before-after()
