const { PDFNet } = require("@pdftron/pdfnet-node");
const demo = process.env.demo;
let images = [],
  image_counter = 0,
  pageHeight;

const imageExtract = async (reader, outputPath) => {
  let element;
  while ((element = await reader.next()) !== null) {
    switch (await element.getType()) {
      case PDFNet.Element.Type.e_image:
      case PDFNet.Element.Type.e_inline_image:
        const ctm = await element.getCTM();
        let x2 = 1,
          y2 = 1;
        const result = await ctm.mult(x2, y2);
        x2 = result.x;
        y2 = result.y;

        if (demo) {
          console.log("--> Image: " + ++image_counter);
          console.log(" Width: " + (await element.getImageWidth()));
          console.log(" Height: " + (await element.getImageHeight()));
          console.log(" BPC: " + (await element.getBitsPerComponent()));
          console.log(
            " Coords: x1=" +
              ctm.m_h.toFixed(2) +
              ", y1=" +
              ctm.m_v.toFixed(2) +
              ", x2=" +
              x2.toFixed(2) +
              ", y2=" +
              y2.toFixed(2)
          );
        }

        if ((await element.getType()) == PDFNet.Element.Type.e_image) {
          const image = await PDFNet.Image.createFromObj(
            await element.getXObject()
          );
          image.export(outputPath + "image_extract1_" + image_counter);
          const temp = new Map([
            ["name", "image_extract1_" + image_counter],
            ["x1", Number(ctm.m_h.toFixed(2))],
            // ["y1", pageHeight - Number(ctm.m_v.toFixed(2))],
            ["y2", pageHeight - Number(ctm.m_v.toFixed(2))],
            ["x2", Number(x2.toFixed(2))],
            // ["y2", pageHeight - Number(y2.toFixed(2))],
            ["y1", pageHeight - Number(y2.toFixed(2))],
            ["isCompleteImage", "Unknown...👻"],
          ]);
          images.push(temp);
        }
        break;
      case PDFNet.Element.Type.e_form: // Process form XObjects
        reader.formBegin();
        await imageExtract(reader, outputPath);
        reader.end();
        break;
    }
  }
  return images;
};

const ImageExtractor = async (inputPath, outputPath, pHeight) => {
  pageHeight = pHeight;
  // await await PDFNet.initialize(
  //   "demo:kishore.k@harnstech.com:7abe10f00200000000ab2ff8f0e2d8d969089ccb724506a23f33470aeb"
  // );
  const doc = await PDFNet.PDFDoc.createFromFilePath(inputPath);
  doc.initSecurityHandler();

  const reader = await PDFNet.ElementReader.create();
  const itr = await doc.getPageIterator(1);
  // Read every page
  for (itr; await itr.hasNext(); await itr.next()) {
    const page = await itr.current();
    reader.beginOnPage(page);
    await imageExtract(reader, outputPath);
    reader.end();
  }
  let imgArr = await imageExtract(reader, outputPath);
  return imgArr;
};

module.exports = ImageExtractor;
