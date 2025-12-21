export function detectIntent(question) {
  const q = question.toLowerCase();

  if (/^(how do i|how to|procedure|steps)/.test(q)) {
    return "procedure";
  }

  if (/^(what is|define|what does)/.test(q)) {
    return "definition";
  }

  if (/requirement|criteria|eligibility/.test(q)) {
    return "requirement";
  }

  if (/deadline|when is|last date|by when|due date/.test(q)) {
    return "deadline";
  }

  return "general";
}
