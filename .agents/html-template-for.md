# `<template for>` — declarative out-of-order streaming

A transcription of the normative HTML/DOM text that rendu's `defer()` implementation
targets. Kept here so agents working on `src/_runtime.ts` do not have to re-derive the
algorithms from the living standard.

**This is a copy, not the source of truth.** Where this file and the specs below
disagree, the specs win.

## Sources

| What                             | Where                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposal                         | [whatwg/html#11818 — "Add `<template for>` for declarative out-of-order streaming"](https://github.com/whatwg/html/pull/11818), by Philip Jägenstedt |
| Merge commit                     | [`2ff023f`](https://github.com/whatwg/html/commit/2ff023fbe4306f79bca8ef3aec27473455d2e190), merged 2026-08-20                                       |
| Issue                            | [whatwg/html#11542](https://github.com/whatwg/html/issues/11542)                                                                                     |
| `for` attribute                  | <https://html.spec.whatwg.org/multipage/scripting.html#attr-template-for>                                                                            |
| Tree construction                | <https://html.spec.whatwg.org/multipage/parsing.html#appropriate-place-for-inserting-a-node>                                                         |
| Processing instruction tokenizer | <https://html.spec.whatwg.org/multipage/parsing.html#processing-instruction-open-state>                                                              |
| PI attribute map                 | <https://dom.spec.whatwg.org/#get-a-processing-instruction-attribute>                                                                                |
| Web platform tests               | [wpt#61156](https://github.com/web-platform-tests/wpt/pull/61156) · [results](https://wpt.fyi/results/html/dom/partial-updates?q=template-for)       |
| Explainer                        | [WICG/declarative-partial-updates](https://github.com/WICG/declarative-partial-updates/blob/main/patching-explainer.md)                              |

Implementation bugs: [Chromium 431374376](https://issues.chromium.org/issues/431374376) ·
[Gecko 2053472](https://bugzilla.mozilla.org/show_bug.cgi?id=2053472) ·
[WebKit 318869](https://bugs.webkit.org/show_bug.cgi?id=318869).
Chrome 148 ships it behind _Experimental Web Platform Features_.

Transcribed 2026-09-03 against the state of the specs on that date.

## The `for` content attribute

> The **`for`** content attribute identifies the `ProcessingInstruction` that marks the
> location at which to insert content (`<?marker>`) or the start of the range to replace
> (`<?start>`). If the attribute is specified, the attribute's value must equal the value
> of the `name` attribute of a `<?marker>` or `<?start>` `ProcessingInstruction` in the
> same tree as the `template` element.

Added to `HTMLTemplateElement`:

```webidl
[CEReactions, Reflect="for"] attribute DOMString htmlFor;
```

`'htmlFor' in HTMLTemplateElement.prototype` is therefore the feature detect.

Each `template` element gains three associated values, all initially null:

- **insertion target** — an `Element`, `DocumentFragment`, or null
- **insertion start marker** — a `ProcessingInstruction` or null
- **insertion end marker** — a `ProcessingInstruction` or null

## Marker syntax

Markers are real `ProcessingInstruction` nodes. Two forms:

```html
<?marker name="x">
<!-- a point; replaced by the patch -->
<?start name="x"> …placeholder… <?end>
<!-- a range; contents replaced by the patch -->
```

`<?start>` ranges nest. Both `<?marker name="x">` and `<?marker name="x"?>` are valid —
see the tokenizer notes below.

## Algorithm: prepare content patching

Given an `Element` or `DocumentFragment` _scope_ and a `template` element _template_:

1. Assert: _template_'s `for` attribute is specified.
2. Let _markerName_ be _template_'s `for` attribute's value.
3. If _markerName_ is the empty string, then return false.
4. Let (_start_, _end_) be the result of **find markers** given _scope_ and _markerName_.
5. If _start_ is null, then return false.
6. Set _template_'s **insertion target** to _start_'s parent.
7. Set _template_'s **insertion start marker** to _start_.
8. Set _template_'s **insertion end marker** to _end_.
9. If _start_ is _end_, then return true.
10. Let _removedNodes_ be an empty list.
11. Let _currentNode_ be _start_'s next sibling.
12. While _currentNode_ is not null:
    1. If _currentNode_ is _end_, then break.
    2. Append _currentNode_ to _removedNodes_.
    3. Set _currentNode_ to _currentNode_'s next sibling.
13. For each _node_ of _removedNodes_: if _node_'s parent is not null, then remove _node_.
    > The parent might have changed because removing a node can fire events like the
    > `pagehide` event, and an event handler can mutate the DOM. The parent identity is not
    > checked; as long as the node still has a parent, it is removed.
14. Return true.

The placeholder is therefore destroyed when the template's **start tag** is parsed, not
when its content finishes arriving.

## Algorithm: find markers

Given a node _scope_ and a string _name_:

1. For each _descendant_ of _scope_'s descendants, in tree order:
   1. If _descendant_ is not a `ProcessingInstruction` node, then continue.
   2. If the result of **getting a processing instruction attribute** given _descendant_
      and "`name`" is not _name_, then continue.
   3. If _descendant_'s target is "`marker`", then return (_descendant_, _descendant_).
   4. If _descendant_'s target is "`start`":
      1. Let _start_ be _descendant_.
      2. Let _nestingLevel_ be 0.
      3. Let _sibling_ be _start_'s next sibling.
      4. While _sibling_ is not null:
         1. If _sibling_ is a `ProcessingInstruction` node:
            1. If _sibling_'s target is "`start`", then increment _nestingLevel_ by one.
            2. If _sibling_'s target is "`end`":
               1. If _nestingLevel_ is 0, then return (_start_, _sibling_).
               2. Decrement _nestingLevel_ by one.
         2. Set _sibling_ to _sibling_'s next sibling.
      5. Return (_start_, null).
         > No matching `<?end>` was found, which is interpreted as a range from _start_ to
         > the end of its parent.
2. Return (null, null).

Note the asymmetry: the _name_ is matched only on the opening `<?marker>` / `<?start>`;
`<?end>` carries no name and is matched purely by nesting depth.

## Tree construction

### A `<template>` start tag with `for`

In "the rules for the in body insertion mode", after the `shadowrootmode` branch:

1. Let _scope_ be the node that contains the **adjusted insertion location**.
   > In the fragment case, _scope_ can be the `DocumentFragment` into which nodes are
   > being inserted.
2. If _scope_ is a `template` element, then set _scope_ to _scope_'s template contents.
   > This is to support patching inside plain `template` elements or those using
   > `shadowrootmode`. Nested patching is not supported, since in this case the `template`
   > element's template contents will have no children and **prepare content patching**
   > will fail.
3. Otherwise, if _scope_ is **the body element** of its node document, then set _scope_ to
   its parent.
   > This is to support patching `head` with a `template` inside `body`.
4. Let _template_ be the result of **insert a foreign element** for _templateStartTag_,
   with HTML namespace and true (i.e. _onlyAddToElementStack_) — **the template element is
   not inserted into the document**.
5. Let _success_ be the result of **prepare content patching** given _scope_ and _template_.
6. If _success_ is false:
   1. Assert: _template_ is the current node.
   2. Pop the current node off the stack of open elements.
   3. **Insert an element at the adjusted insertion location** with _template_.
   4. Push _template_ onto the stack of open elements.
      > The above steps undo the effect of the _onlyAddToElementStack_ argument …
      > inserting it where it would have been inserted otherwise. **This is to signal an
      > error.**

So a failed patch (empty or unmatched `for`) leaves an inert `<template>` in the DOM — the
content is silently dropped, there is no exception and no event.

### Appropriate place for inserting a node

The template redirection step becomes:

1. If _adjusted insertion location_ is inside a `template` element:
   1. Let _template_ be that element.
   2. Let _target_ be _template_'s **insertion target**.
   3. If _target_ is not null:
      1. If _template_'s **insertion end marker** is not null and its parent is _target_,
         then set _adjusted insertion location_ to inside _target_, before _template_'s
         insertion end marker.
         > If the end marker has been removed or moved to another node, nodes are instead
         > appended to _target_ in the following step.
      2. Otherwise, set _adjusted insertion location_ to inside _target_, after its last
         child (if any).
   4. Otherwise, set _adjusted insertion location_ to inside _template_'s template
      contents, after its last child (if any).

This is what makes patches **progressive**: children of the patching template are inserted
into the live target as they parse, rather than being buffered into template contents and
moved at the end.

### A `</template>` end tag

Before popping the stack:

1. Let _template_ be the last `template` element in the stack of open elements.
   > This is … not necessarily the current node, as the content of a `template` element
   > with a `for` attribute might have left an element open.
2. If _template_'s insertion target is not null:
   1. Let _start_ be _template_'s insertion start marker, _end_ its insertion end marker.
   2. Assert: _start_ is not null.
   3. If _start_'s parent is not null, then remove _start_.
   4. If _end_ is not null and _end_'s parent is not null, then remove _end_.
   5. Set insertion target, insertion start marker and insertion end marker to null.

The markers are consumed, so a given marker can only be patched once.

## Processing instructions in HTML

`<?…>` used to be a bogus comment. It is now tokenized into a real
`ProcessingInstruction`. The states, in order:

**Processing instruction open state** — consume the next input character:

- ASCII alpha, `_` → reconsume in the _processing instruction target state_.
- EOF → `eof-in-processing-instruction` parse error; emit an end-of-file token.
- Anything else → `invalid-first-character-of-processing-instruction-target` parse error;
  convert the temporary buffer to a comment; reconsume in the _bogus comment state_.

**Processing instruction target state** — consume the next input character:

- tab, LF, FF, space, `?`, `>` → let _target_ be the temporary buffer. If _target_ is an
  ASCII case-insensitive match for "`xml`" or "`xml-stylesheet`", this is a
  `disallowed-processing-instruction-target` parse error; convert the temporary buffer to a
  comment and reconsume in the _bogus comment state_. Otherwise create a processing
  instruction token with that target and empty data, and reconsume in the _after processing
  instruction target state_.
- ASCII alphanumeric, `-`, `_` → append to the temporary buffer.
- Anything else → `invalid-processing-instruction-target` parse error; convert the
  temporary buffer to a comment; reconsume in the _bogus comment state_.

**After processing instruction target state** — ignore whitespace; anything else reconsumes
in the _processing instruction data state_.

**Processing instruction data state** — `?` switches to the _questionable state_; `>`
switches to the data state and emits the token; anything else appends to the token's data.

**Processing instruction questionable state** — `>` switches to the data state and emits
the token; anything else appends `?` to the data and reconsumes in the _data state_.

Consequences that matter:

- **`<?` followed by an ASCII letter or `_` starts a PI.** This is why rendu's tokenizer
  (`src/parser.ts`) only treats `<?=`, `<?js` and `<?` + whitespace as its own tags — see
  the `tagRe` comment there.
- Both `<?marker name="x">` and `<?marker name="x"?>` are valid and produce the same node;
  the trailing `?` is consumed by the questionable state.
- `xml` and `xml-stylesheet` targets are disallowed in HTML.
- In a browser that predates this, `<?marker name="x">` is a **bogus comment** whose data is
  `?marker name="x"` (everything up to the first `>`, leading `?` included). rendu's client
  fallback relies on exactly that.

### PI attributes (DOM)

`ProcessingInstruction` nodes carry an **attribute map** parsed from their data in
pseudo-attribute form, exposed through `getAttribute()` / `setAttribute()` /
`hasAttributes()`.

> To **get a processing instruction attribute**, given a `ProcessingInstruction` node _pi_
> and a string _name_: return _pi_'s attribute map[*name*] with default null.

## Examples (verbatim from the spec)

Populating a `select` after the main content has been delivered:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Out-of-order countries</title>
    <style>
      #countries:empty {
        opacity: 0;
      }
    </style>
  </head>
  <body>
    <select id="countries">
      <?marker name="country-options"?>
    </select>
    ...
    <template for="country-options"
      ><option>Antigua</option>
      ...</template
    >
  </body>
</html>
```

> The `<?marker?>` processing instruction is replaced with the `option` elements from the
> later `template` element. The `select` element is transparent until it is populated.

Streaming a document out of order, static content first:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Async recommendation engine</title>
    <style>
      aside {
        /* position the aside where it can grow without causing layout shift or obscuring other content */
      }
      aside:has(.placeholder) {
        /* style the placeholder content */
      }
    </style>
  </head>
  <body>
    <h1>How to train your cat</h1>
    <p>
      Set realistic goals and don't expect your cat to make a perfect cup of tea on the first try.
    </p>
    <aside>
      <p>Recommended reading:</p>
      <?start name="recommended">
      <ul class="placeholder">
        <li>...</li>
        <li>...</li>
        <li>...</li>
      </ul>
      <?end>
    </aside>
    <p>...</p>
    <p>Now sit back and enjoy your tea with your cat.</p>

    <!-- The server has a potentially long delay at this point. -->

    <template for="recommended">
      <ul>
        <li>Cat or butler, which is right for you?</li>
        <li>Rewarding good cat behavior</li>
        <li>Kettles considered harmful</li>
      </ul>
    </template>
  </body>
</html>
```

> The content between `<?start name="recommended">` and `<?end>` is replaced with the
> `template` contents. Since the new content does not use `class="placeholder"`, the
> placeholder styling no longer applies.

## How rendu maps onto this

Not part of the spec — a pointer for anyone changing the implementation.

- `defer(value, placeholder?)` (`src/_runtime.ts`) writes `<?marker name="dN">` when there
  is no placeholder and `<?start name="dN">…<?end>` when there is, then queues the value.
- `concatStreams()` flushes queued values in **completion order** as
  `<template for="dN">…</template>` after the shell, so a slow patch never blocks a fast one.
- The marker always precedes its template in the byte stream, which **find markers**
  requires.
- Patches are emitted after `</body></html>`; per "after after body" that is a parse error
  processed with the in-body rules, so _scope_ is the body element and is widened to `html`
  — which is also what would allow patching `head`.
- A failed patch is silent by design (see the start-tag steps above), so rendu generates its
  own marker names rather than accepting user-supplied ones.
- The client fallback covers browsers without `htmlFor` on `HTMLTemplateElement.prototype`.
  It walks both `ProcessingInstruction` and comment nodes, because a browser could ship the
  PI tokenizer before `<template for>`.
