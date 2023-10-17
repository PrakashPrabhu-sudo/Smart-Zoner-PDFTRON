const fs = require("fs");
const axios = require("axios");
const util = require("util");
const parseString = util.promisify(require("xml2js").parseString);
const { PDFNet } = require("@pdftron/pdfnet-node");

// Local files
const imageExtract = require("./Utils/imageExtract");
const unzipper = require("./Utils/Unzipper");
const CartesianThings = require("./Utils/CartesianThings");

const demo = process.env.demo;

const articleZoning = async (bufferData) => {
  try {
    if (demo) console.log("Article Zoning Started");
    const res = await axios.post(
      "https://ai-serve.pdftron.com/recog/predict",
      bufferData.data,
      {
        headers: {
          "File-Name": bufferData.name,
          "Output-XFDF": true,
          "Output-JSON": true,
          // "Output-XLSX": true,
          // "Output-DOCX": true,
          // "Output-HTML": true,
        },
        responseType: "arraybuffer",
      }
    );
    const contentType = res.headers["content-type"];
    console.log("contentType: ", contentType);

    let buffer = Buffer.from(res.data);
    if (demo) {
      fs.writeFile(`${__dirname}/articleZone.zip`, buffer, (err) => {
        if (err) console.log(err);
        else console.log("Article Zoning Success");
      });
    }

    return buffer;
  } catch (error) {
    console.log("error: ", error);
  }
};

const surfaceZoning = async (pdfFile, pdfFileName) => {
  try {
    if (demo) console.log("Surface Zoning Started");
    const res = await axios.post(
      "https://ai-serve.pdftron.com/segment/predict",
      pdfFile,
      {
        headers: {
          "File-Name": pdfFileName,
          "Output-XFDF": true,
          "Output-JSON": true,
        },
        responseType: "arraybuffer",
      }
    );
    const contentType = res.headers["content-type"];
    console.log("contentType: ", contentType);

    let buffer = Buffer.from(res.data);
    if (demo) {
      fs.writeFile(`${__dirname}/surfaceZone.zip`, buffer, (err) => {
        if (err) console.log(err);
        else console.log("Surface Zoning Success");
      });
    }

    return buffer;
  } catch (error) {
    console.log("error: ", error);
  }
};

// const getPdf = (path) => {
//   const originalFile = fs.readFileSync(__dirname + "/" + path);
//   return originalFile;
// };
const getPdf = async (path) => {
  const originalFile = fs.readFileSync(__dirname + "/" + path);
  const doc = await PDFNet.PDFDoc.createFromFilePath(path);
  doc.initSecurityHandler();
  const itr = await doc.getPageIterator();
  const curPage = await itr.current();
  var pageHeight = await curPage.getPageHeight();
  return { originalFile, pageHeight };
};

const main = async () => {
  // Image Extraction
  const tempImgArr = await imageExtract(
    `${__dirname}/test.pdf`,
    `${__dirname}/Images/`
  );

  // Checking each images if their centers are inside other image
  // if yes, merging those images together
  let imgArr = [];
  let num = 0;
  while (num < tempImgArr.length - 1) {
    const firstImg = tempImgArr[num];
    const secondImg = tempImgArr[num + 1];
    const centerofBox1 = CartesianThings.centerOf(tempImgArr[num]);
    const centerofBox2 = CartesianThings.centerOf(tempImgArr[num + 1]);

    // First inside second
    const FIS = CartesianThings.isContainedWitinin(centerofBox1, secondImg);

    // Second inside first
    const SIF = CartesianThings.isContainedWitinin(centerofBox2, firstImg);
    if (FIS || SIF) {
      const newImg = CartesianThings.mergeBox(firstImg, secondImg);
      newImg.delete("isCompleteImage");
      imgArr.push(newImg);
    } else {
      const temp = new Map(firstImg);
      temp.delete("isCompleteImage");
      imgArr.push(temp);
    }
    num++;
  }
  imgArr.push(new Map(tempImgArr[num]));
  // -------ImgArr contains the required image information----------

  const pdfFileName = "test.pdf";
  const { originalFile: file, pageHeight } = await getPdf(pdfFileName);

  // Surface Zoning Started...
  const pdfAnnotation = await surfaceZoning(file, pdfFileName);

  const annotationContents = unzipper(pdfAnnotation);
  const pdfFileWithAnotation = annotationContents.files.find((item) =>
    item.name.endsWith(".pdf")
  );

  // Article Zoning Started...
  const articleZone = await articleZoning(pdfFileWithAnotation);
  const coordinateContents = unzipper(articleZone);

  const reqFile = {};
  coordinateContents.files.forEach((file) => {
    if (file.name.endsWith(".json")) reqFile.json = file;
    else if (file.name.endsWith(".xfdf")) reqFile.xfdf = file;
  });

  // Surface zones
  let zones = [];
  const xfdfData = await parseString(reqFile.xfdf.data);
  for (let zone of xfdfData.xfdf.annots[0].square) {
    // const [x1, y1, x2, y2] = zone.$.rect.split(",");
    const [x1, y2, x2, y1] = zone.$.rect.split(",");
    const color = zone.$.color;
    // var x1 = rectCoordinates[0],
    //   y2 = rectCoordinates[1],
    //   x2 = rectCoordinates[2];
    // y1 = rectCoordinates[3];
    let Y1 = pageHeight - y2;
    let HEIGHT = y2 - y1;
    zones.push(
      new Map([
        ["x1", +x1],
        ["y1", pageHeight - y1],
        ["x2", +x2],
        ["y2", pageHeight - y2],
        ["color", color],
        ["article no", zones.length + 1],
      ])
    );
  }
  console.log(zones);
  // Article Zones
  let textContents = Buffer.from(reqFile.json.data);
  textContents = textContents.toString("utf-8");
  textContents = JSON.parse(textContents);
  let textZone = [];
  for (let segment of textContents.pages[0].elements) {
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity,
      content = "";
    for (let para of segment.kids) {
      if (!content) content += para.text;
      else content = content + "\n" + para.text;
      x1 = Math.min(para.rect[0], x1);
      // y1 = Math.min(pageHeight - para.rect[1], y1);
      y1 = Math.min(pageHeight - para.rect[3], y1);
      x2 = Math.max(para.rect[2], x2);
      // y2 = Math.max(pageHeight - para.rect[3], y2);
      y2 = Math.max(pageHeight - para.rect[1], y2);
    }
    textZone.push(
      new Map([
        ["x1", x1],
        ["y1", y1],
        ["x2", x2],
        ["y2", y2],
        ["content", content],
        ["tagged", false],
      ])
    );
  }
  // console.log("textContents: ", textContents);
  for (let zone of zones) {
    for (let segment of textZone) {
      if (segment.get("tagged")) continue;
      const centerOfSegment = CartesianThings.centerOf(segment);
      const isContained = CartesianThings.isContainedWitinin(
        centerOfSegment,
        zone
      );
      if (isContained) {
        segment.set("tagged", true);
        segment.set("taggedTo", zone.get("article no"));
      }
    }
  }
  console.log("textZone: ", textZone);
};

main();
