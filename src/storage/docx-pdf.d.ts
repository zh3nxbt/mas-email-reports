declare module "docx-pdf" {
  type Callback = (err: Error | null) => void;
  function docxPdf(input: string, output: string, callback: Callback): void;
  export = docxPdf;
}
