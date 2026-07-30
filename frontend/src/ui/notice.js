// Minimal non-blocking "toast" notice component (tasks 7.7/7.9). Unlike
// `promptModal` (which blocks for one answer and removes itself), a notice
// is informational: it stacks in a corner, several can be visible at once
// (e.g. an interop loss report followed by a later rename-collision
// notice), and it stays until the user dismisses it — spec `jflap-interop`
// > "Visible Loss Report" and `diagram-editor` > "State Identifier
// Conflicts Are Never Silent" both require the message to be *visible*, not
// a console log or a value nobody reads. Plain DOM/CSS, no new dependency,
// same vanilla-JS style as `promptModal.js`.

/**
 * @param {{kind?: 'info'|'error', title?: string, message?: string, items?: string[]}} options
 * @returns {{dismiss: () => void, element: HTMLElement}}
 */
export function showNotice({ kind = "info", title = "", message = "", items = [] } = {}) {
  const stack = ensureStack();

  const el = document.createElement("div");
  el.className = `notice notice-${kind}`;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "notice-close";
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => dismiss());

  const heading = document.createElement("strong");
  heading.className = "notice-title";
  heading.textContent = title;

  const body = document.createElement("p");
  body.className = "notice-message";
  body.textContent = message;

  el.append(closeButton, heading, body);

  if (items.length) {
    const list = document.createElement("ul");
    list.className = "notice-items";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    }
    el.appendChild(list);
  }

  stack.appendChild(el);

  function dismiss() {
    el.remove();
  }

  return { dismiss, element: el };
}

function ensureStack() {
  let stack = document.querySelector(".notice-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "notice-stack";
    document.body.appendChild(stack);
  }
  return stack;
}
