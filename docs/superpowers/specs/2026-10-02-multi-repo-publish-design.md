# Publish to several repositories - Design

Issue: #6

## Purpose

Publish one draft as an issue in several repositories at once, while keeping
the single-repository flow: choosing one repository behaves exactly as today.

## Decisions

| Question | Decision |
|---|---|
| How repositories are chosen | A checkbox list with a name filter. One checked box is the single-repository case. |
| A repository fails mid-way | Keep publishing to the rest, report each failure, keep the draft with only the failed repositories selected so a retry is one click. |
| Daily publish cap (50) | Counts issues, not requests: three repositories spend three. If the cap cannot cover all of them, nothing is published. |
| Most repositories per publish | 10. See "Limits". |

## API

`POST /api/publish` takes `repos` (an array of names) instead of `repo`. The
page is the only client and ships with the Worker, so there is no
compatibility shim for `repo`.

```
{ "repos": ["LoopifyBot", "issue-drafter"], "type": "task", "title": "...", "body": "..." }
```

Validation, before anything is written:

1. `repos` is a non-empty array of strings, at most 10 after removing
   duplicates. Otherwise `400`. Checked with the other fields, before the
   per-minute limit, since it needs no network.
2. Per-minute publish limit, as today (one unit per request).
3. Every name is one of the owner's repositories (one listing). Otherwise `400`.
4. Daily cap consumes `repos.length` units at once.

Then, for each repository **in order, one at a time** (GitHub asks for
content-creating requests to be serial): ensure the label, create the issue.
A failure is recorded and the loop moves on.

Responses:

- At least one issue created: `201`
  ```
  { "created": [{ "repo": "LoopifyBot", "number": 7, "url": "https://..." }],
    "failed":  [{ "repo": "issue-drafter", "error": "The repository is unavailable or has issues disabled." }] }
  ```
- None created: the first failure is answered exactly as a single-repository
  publish answers it today (same status and message), so the single case is
  unchanged.

The per-repository `error` uses the same mapping as the route-level error
response. That mapping becomes one function that turns any error into an
`HttpError`, used both by the route-level response and by each failure.

## Limits

The Workers Free plan allows 50 subrequests per invocation. A publish spends
up to 5 listing repositories, then up to 3 per repository (label lookup,
label creation, issue creation). 10 repositories is 35, which leaves room.

`Limits.consumeDaily(kind, now, amount = 1)` refuses when `count + amount`
exceeds the cap and otherwise adds `amount`. Drafts keep spending one.

## Page

**Repository picker.** Replaces the `<select>`:

```
Repositories                                  2 / 10 selected
[ (search icon)  Filter repositories                       ]
+----------------------------------------------------------+
| [x] issue-drafter                                        |
| [ ] LoopifyBot                                   private |
| ...  scrolls after about six rows                        |
+----------------------------------------------------------+
```

- A `role="group"` labelled by its visible heading; each row is a real
  `<label>` around a checkbox, at least 44 px tall, with a visible focus ring
  and a tinted background when checked.
- The filter hides rows whose name does not contain the text
  (case-insensitive). With no match it shows "No repositories match".
- At 10 selected, unchecked boxes are disabled (dimmed, not-allowed cursor)
  until one is unchecked.
- Loading, error and empty states reuse the list's message row.
- The selection is saved in `localStorage` as `repos` and, after the listing
  loads, pruned to repositories that still exist.

**Result.** The success card lists one link per created issue
("LoopifyBot #7"), each opening GitHub in a new tab. Its heading reads "Issue
#7 created in LoopifyBot" for one issue and "3 issues created" for several.

**Partial failure.** The created issues are shown as above; the status toast
shows an error naming each failed repository and its reason; the draft and
note stay, and the selection becomes the failed repositories. Full success
clears the note and draft as today.

## Testing

- `handler.test.ts`: several repositories create several issues with one label
  check each, in order; duplicates are removed; an empty, non-array or
  over-10 list is `400` without spending the cap; one unknown repository
  rejects the whole request; a failure in one repository still creates the
  rest and reports it; all failing answers the first failure's mapping; the
  cap is consumed with the repository count.
- `limits.test.ts`: `consumeDaily` with an amount, including an amount that
  does not fit.
- `page.test.ts`: the picker and filter ids are present.
- Manual check in the browser with `npm run dev`: picker, filter, the
  10-limit, and the result card in light and dark.

## Out of scope

- Different titles, bodies or labels per repository.
- Publishing to repositories outside the token owner's account.
