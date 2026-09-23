/** A text field from form data; a file or a missing field reads as empty rather than "[object File]". */
export function formText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
