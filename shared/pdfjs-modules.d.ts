// pdf.js ships types for its main module but not for the worker module, which the PDF extractor loads for its side
// effect so that pdf.js can run in the thread it is called from.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs'
