# Inner Depth reference library

A small, version-controlled set of psychological principles that the AI organizer may draw on when
it words a reflection. Every entry is an **original summary written for this project**; none reproduces
copyrighted text beyond short, attributed phrases that fall under fair quotation. Bibliographic sources
are real and were checked against publisher or index records (Crossref, PubMed) when added.

The library exists to shape *how* the organizer listens and words things, never to label the participant.
A principle can justify a tentative, second-person wording. It cannot justify telling someone what type
they are, what they unconsciously want, or why they became who they are.

## Entry format (`library/psychology/*.json`)

Each file holds an array of entries:

| field | meaning |
|---|---|
| `id` | stable identifier, `thinker-concept` |
| `thinker` | the person or tradition |
| `concept` | the named idea |
| `summary` | original explanation, two to five sentences, in our words |
| `source` | `{ citation, type, year, doi?, identifier? }` with real bibliographic data |
| `evidence_limitations` | what the research base does and does not support |
| `appropriate_application` | how the organizer may use it when wording a reflection |
| `inappropriate_application` | uses that are forbidden |
| `tags` | retrieval hints |

## Curation rules

1. Do not add an entry without a verifiable source. No invented page numbers, DOIs or quotations.
2. Summaries are original prose. Do not paste from books, articles or websites.
3. Public-domain primary texts (Plato in older translations, Freud's early works in some jurisdictions)
   are still summarised rather than reproduced; translation copyright varies by edition.
4. Historical frameworks (Freud, Jung) are included for their listening posture and vocabulary of
   inner multiplicity and conflict, not as validated clinical models. Say so in `evidence_limitations`.
5. Each entry must state at least one inappropriate application.
6. `node --test tests/unit/library.test.js` checks the format, id uniqueness and required fields.

## Current scope

Rogers (person-centred conditions, reflective listening, the organismic valuing process), Jung (persona,
individuation, tension of opposites, psychological types as *his* framing of difference), Schwartz
(Internal Family Systems: parts, Self, no bad parts), Freud (ambivalence, defence, the talking cure's
stance of listening), Socratic inquiry (elenchus, aporia, midwifery), and modern research on empathy,
reflective listening and guided discovery (Elliott et al. 2018; Norcross & Lambert 2018; Weger et al. 2014;
Braun et al. 2015; Kazantzis et al. 2018; Overholser & Beale 2023; Miller & Rollnick 2013).
