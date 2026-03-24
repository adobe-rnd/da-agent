---
name: Translate Content
description: Translates the current page into a requested language and saves it under a language-specific folder, preserving the original path structure.
triggers:
  - translate
  - translate this page
  - translate to
  - translate into
---

# Translate Content

Translate the current page into the language the user requests, then store the result as a new document under a language-specific root folder while keeping the same path structure as the original.

## Steps

1. **Identify the target language**
   - Extract the language name from the user's message (e.g. "German", "French", "Spanish").
   - Map it to a BCP 47 language code using the table below. If the language is not listed, derive the correct two-letter ISO 639-1 code.

   | Language   | Code |
   |------------|------|
   | German     | de   |
   | French     | fr   |
   | Spanish    | es   |
   | Italian    | it   |
   | Portuguese | pt   |
   | Dutch      | nl   |
   | Japanese   | ja   |
   | Korean     | ko   |
   | Chinese    | zh   |
   | Arabic     | ar   |

2. **Read the current page**
   - Use `da_get_source` with the org, repo, and path from the current page context.
   - Do not ask the user for the path — always use the page context.

3. **Determine the target path**
   - Take the current page path and prepend the language code as the first path segment.
   - Strip any leading slash from the original path before prepending.
   - Examples:
     - `/products/my-page.html` → `/de/products/my-page.html`
     - `/blog/2024/post.html` → `/fr/blog/2024/post.html`
     - `/index.html` → `/es/index.html`

4. **Translate the content**
   - Translate all visible text into the target language.
   - Preserve the complete EDS HTML structure exactly: `<body>`, `<main>`, section `<div>`s, block `<div class="...">` elements, heading hierarchy, and all HTML attributes.
   - Do NOT translate: HTML tag names, class names, `href` and `src` attribute values, `alt` attributes of images that are file paths, or any other non-visible attribute values.
   - DO translate: all visible text content inside elements, `alt` attributes that are descriptive text for images, `title` attributes.
   - Maintain the same EDS block structure — do not add, remove, or restructure any blocks or sections.

5. **Save the translated page**
   - Use `da_create_source` with the org, repo, and target path from step 3.
   - Pass the fully translated HTML string as the content.
   - If the file already exists at the target path, use `da_update_source` instead.

6. **Confirm**
   - Tell the user the translation is done, which language was used, and the path where the translated page was saved.
   - Do not output the translated HTML in the response.

## Rules

- Always read the source content first — never translate from memory or invent content.
- Never modify the source page.
- Never output raw HTML in the response.
- If the user does not specify a language, ask for clarification before proceeding.
- If the page context is missing, inform the user that you need to be on a page to use this skill.
