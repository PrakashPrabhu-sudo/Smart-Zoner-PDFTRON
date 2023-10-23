const fs = require("fs");
const axios = require("axios");
const util = require("util");
const parseString = util.promisify(require("xml2js").parseString);
const { PDFNet } = require("@pdftron/pdfnet-node");

// Local files
const imageExtract = require("./Utils/imageExtract");
const unzipper = require("./Utils/Unzipper");
const CartesianThings = require("./Utils/CartesianThings");
const colorArr = require("./Utils/colors");

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
  await await PDFNet.initialize(
    "demo:kishore.k@harnstech.com:7abe10f00200000000ab2ff8f0e2d8d969089ccb724506a23f33470aeb"
  );
  const pdfFileName = "test.pdf";
  const { originalFile: file, pageHeight } = await getPdf(pdfFileName);
  // Image Extraction
  const tempImgArr = await imageExtract(
    `${__dirname}/test.pdf`,
    `${__dirname}/Images/`,
    pageHeight
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
      newImg.set("Tag", "Image");
      imgArr.push(newImg);
    } else {
      const temp = new Map(firstImg);
      temp.delete("isCompleteImage");
      temp.set("Tag", "Image");
      imgArr.push(temp);
    }
    num++;
  }
  const temp = new Map(tempImgArr[num]);
  temp.delete("isCompleteImage");
  imgArr.push(temp);
  // -------ImgArr contains the required image information----------

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
    zones.push(
      new Map([
        ["x1", +x1],
        ["y1", pageHeight - y1],
        ["x2", +x2],
        ["y2", pageHeight - y2],
        ["color", color],
        ["customColor", colorArr[zones.length % 12]],
        ["article no", zones.length + 1],
      ])
    );
  }

  // Article Zones
  let textContents = Buffer.from(reqFile.json.data);
  textContents = textContents.toString("utf-8");
  textContents = JSON.parse(textContents);
  // Merging lines zones to a complete para zones
  let tempTextZone = [];
  for (let segment of textContents.pages[0].elements) {
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity,
      content = "",
      style;
    for (let para of segment.kids) {
      if (!content) content += para.text;
      else content = content + "\n" + para.text;
      style = para.style;
      x1 = Math.min(para.rect[0], x1);
      // y1 = Math.min(pageHeight - para.rect[1], y1);
      y1 = Math.min(pageHeight - para.rect[3], y1);
      x2 = Math.max(para.rect[2], x2);
      // y2 = Math.max(pageHeight - para.rect[3], y2);
      y2 = Math.max(pageHeight - para.rect[1], y2);
    }
    tempTextZone.push(
      new Map([
        ["x1", x1],
        ["y1", y1],
        ["x2", x2],
        ["y2", y2],
        ["Tag", "text"],
        ["style", style],
        ["content", content],
        ["tagged", false],
      ])
    );
  }
  // Merging first letter with body
  let tempMergedTextZone = [];
  let i = 0;
  while (i < tempTextZone.length - 1) {
    const zone = tempTextZone[i];
    const nextZone = tempTextZone[i + 1];
    if (zone.get("content").trim().length === 1) {
      const newZone = CartesianThings.mergeBox(zone, nextZone);
      newZone.set("content", zone.get("content") + nextZone.get("content"));
      tempMergedTextZone.push(newZone);
      i += 2;
    } else {
      tempMergedTextZone.push(zone);
      i++;
    }
  }
  tempMergedTextZone.push(tempTextZone[i]);
  tempTextZone = tempMergedTextZone;
  // Merging article body(zones with same width and if there touch or overlap)
  let textZone = [];
  i = 0;
  let j = 1;
  while (j < tempTextZone.length) {
    const zone = tempTextZone[i];
    const nextZone = tempTextZone[j];
    const cond = (i, j) => {
      return (
        tempTextZone[i].get("x1") - tempTextZone[j].get("x1") <= 1 &&
        tempTextZone[i].get("x2") - tempTextZone[j].get("x2") <= 1 &&
        CartesianThings.isOverlappingOrTouching_approx(
          tempTextZone[i],
          tempTextZone[j]
        )
      );
    };
    if (cond(i, j)) {
      while (cond(j, j + 1)) {
        j++;
      }
      const newZone = CartesianThings.mergeBox(
        tempTextZone[i],
        tempTextZone[j]
      );
      textZone.push(newZone);
      i = j + 1;
      j = i + 1;
    } else {
      textZone.push(zone);
      i++;
      j++;
    }
  }
  textZone.push(tempTextZone[i]);
  // Tagging para and image zones to surface zones
  for (let zone of zones) {
    for (let segment of textZone) {
      if (segment.get("tagged")) continue;
      const isOverlapping = CartesianThings.isOverlapping(segment, zone);
      if (isOverlapping) {
        segment.set("tagged", true);
        segment.set("taggedTo", zone.get("article no"));
      }
    }
    for (let img of imgArr) {
      if (img.get("tagged")) continue;
      const centerOfImage = CartesianThings.centerOf(img);
      const isContained = CartesianThings.isContainedWitinin(
        centerOfImage,
        zone
      );
      if (isContained) {
        img.set("tagged", true);
        img.set("taggedTo", zone.get("article no"));
      }
    }
  }
  // Handling UnTagged data
  let unTaggedTextZone = textZone
    .filter((item) => !item.get("tagged"))
    .map((item) => {
      const temp = new Map(item);
      temp.set("tagged", true);
      temp.set("taggedTo", "unknown...👻");
      return temp;
    });
  let unTaggedImg = imgArr
    .filter((item) => !item.get("tagged"))
    .map((item) => {
      const temp = new Map(item);
      temp.set("tagged", true);
      temp.set("taggedTo", "unknown...👻");
      return temp;
    });

  textZone = textZone.concat(unTaggedTextZone);
  imgArr = imgArr.concat(unTaggedImg);

  // Object with article no as key and value as para zones
  const articleCollection = {};
  for (let data of textZone) {
    if (!data.get("tagged")) continue;
    else {
      const reqData = {
        zoneText: data.get("content"),
        style: data.get("style"), //TODO: no need to store this
        Tag: data.get("Tag"),
        coordinates: {
          x1: data.get("x1"),
          y1: data.get("y1"),
          x2: data.get("x2"),
          y2: data.get("y2"),
        },
      };
      if (!articleCollection[`article_no:${data.get("taggedTo")}`]) {
        articleCollection[`article_no:${data.get("taggedTo")}`] = [reqData];
      } else
        articleCollection[`article_no:${data.get("taggedTo")}`].push(reqData);
    }
  }
  // Object with article no as key and value as image zones
  for (let img of imgArr) {
    if (img.get("tagged") == null) continue;
    else {
      const reqData = {
        Tag: img.get("Tag"),
        coordinates: {
          x1: img.get("x1"),
          y1: img.get("y1"),
          x2: img.get("x2"),
          y2: img.get("y2"),
        },
      };
      if (!articleCollection[`article_no:${img.get("taggedTo")}`]) {
        articleCollection[`article_no:${img.get("taggedTo")}`] = [reqData];
      } else
        articleCollection[`article_no:${img.get("taggedTo")}`].push(reqData);
    }
  }
  for (let zone of zones) {
    if (
      Object.keys(articleCollection).includes(
        `article_no:${zone.get("article no")}`
      )
    ) {
      articleCollection[`article_no:${zone.get("article no")}`] = {
        ArticleJson: articleCollection[`article_no:${zone.get("article no")}`],
        color: zone.get("customColor"),
        coordinates: {
          x1: zone.get("x1"),
          y1: zone.get("y1"),
          x2: zone.get("x2"),
          y2: zone.get("y2"),
        },
        articleID: zone.get("article no"),
      };
    }
  }
  articleCollection["article_no:unknown...👻"] = {
    ArticleJson: articleCollection["article_no:unknown...👻"],
    color: "#000000",
    coordinates: {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
    },
    articleID: "unknown",
  };
  const reqArr = [];
  for (let article in articleCollection)
    reqArr.push(articleCollection[article]);
  // DB op
  const mongoose = require("mongoose");
  mongoose.set("strictQuery", true);
  mongoose
    .connect(
      "mongodb+srv://java:gogomaster@database.qrvyh.mongodb.net/smart-zoner?retryWrites=true&w=majority"
    )
    .then(async () => {
      console.log(
        "Connected to DB",
        "mongodb+srv://java:gogomaster@database.qrvyh.mongodb.net/smart-zoner?retryWrites=true&w=majority"
      );
      await mongoose.connection.db.collection("temp_articles").deleteMany({});
      const art = await mongoose.connection.db
        .collection("temp_articles")
        .insertMany(reqArr);
      console.log("art: ", art);
    })
    .catch((err) => console.log(`Unable to connect to DB ${err}`));
  // DB op
  const sample = fs.createWriteStream(`${__dirname}/sample.json`);
  const sampleData = [];
  for (let map of zones) {
    const data = {
      x1: map.get("x1"),
      x2: map.get("x2"),
      y2: map.get("y2"),
      y1: map.get("y1"),
      color: map.get("customColor"),
      "article no": map.get("article no"),
    };
    sampleData.push(data);
  }
  sample.write(JSON.stringify(sampleData));
  sample.close();
};

main();
