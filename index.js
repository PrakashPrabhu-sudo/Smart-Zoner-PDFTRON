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
  // // Merging first letter with body
  // let tempMergedTextZone = [];
  // let i = 0;
  // while (i < tempTextZone.length - 1) {
  //   const zone = tempTextZone[i];
  //   const nextZone = tempTextZone[i + 1];
  //   if (zone.get("content").trim().length === 1) {
  //     const newZone = CartesianThings.mergeBox(zone, nextZone);
  //     newZone.set("content", zone.get("content") + nextZone.get("content"));
  //     tempMergedTextZone.push(newZone);
  //     i += 2;
  //   } else {
  //     tempMergedTextZone.push(zone);
  //     i++;
  //   }
  // }
  // tempMergedTextZone.push(tempTextZone[i]);
  // tempTextZone = tempMergedTextZone;
  // // Merge Completed

  // // Merging article body(zones with same width and if there touch or overlap)
  // let textZone = [];
  // i = 0;
  // let j = 1;
  // while (j < tempTextZone.length) {
  //   const zone = tempTextZone[i];
  //   const nextZone = tempTextZone[j];
  //   const cond = (i, j) => {
  //     const isOverlapping = CartesianThings.isOverlappingOrTouching_approx(
  //       tempTextZone[i],
  //       tempTextZone[j]
  //     );
  //     return (
  //       tempTextZone[i].get("x1") - tempTextZone[j].get("x1") <= 1 &&
  //       tempTextZone[i].get("x2") - tempTextZone[j].get("x2") <= 1 &&
  //       isOverlapping
  //     );
  //   };
  //   if (cond(i, j)) {
  //     while (cond(j, j + 1)) {
  //       j++;
  //     }
  //     const newZone = CartesianThings.mergeBox(
  //       tempTextZone[i],
  //       tempTextZone[j]
  //     );
  //     let newContent = [];
  //     for (let idx = i; idx <= j; idx++)
  //       newContent.push(tempTextZone[idx].get("content"));
  //     newZone.set("content", newContent.join("\n"));
  //     textZone.push(newZone);
  //     i = j + 1;
  //     j = i + 1;
  //   } else {
  //     textZone.push(zone);
  //     i++;
  //     j++;
  //   }
  // }
  // textZone.push(tempTextZone[i]);
  // // Merge Completed
  let textZone = tempTextZone; // comment for merging body (for now)

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
  // Get all article zone segregated based on it's style
  // Sort all of those values in each segregation based on it's distance
  // merge those zones in each segregation if they overlap and have same width/height
  // Merge first letter with zone
  let article_segregation = {};
  for (let [key, article] of Object.entries(articleCollection)) {
    const tempObj = {};
    for (let article_obj of article.ArticleJson) {
      const { articleID, color, coordinates } = article;
      const { zoneText, coordinates: textCoordinate } = article_obj;
      if (article_obj.Tag === "Image") {
        if (tempObj.Image) {
          tempObj.Image = [
            ...tempObj.Image,
            { imageCoordinates: textCoordinate },
          ];
        } else {
          tempObj.Image = [{ imageCoordinates: textCoordinate }];
        }
      } else if (articleID === "unknown") {
        if (tempObj.textContents) {
          tempObj.textContents = [
            ...tempObj.textContents,
            { textCoordinate, zoneText },
          ];
        } else {
          tempObj.textContents = [{ textCoordinate, zoneText }];
        }
      } else {
        // let { name, ...style } = article_obj.style;
        let { name, serif, italic, color, ...style } = article_obj.style;
        style.size = Math.round(style.size);
        if (tempObj[JSON.stringify(style)]) {
          tempObj[JSON.stringify(style)] = [
            ...tempObj[JSON.stringify(style)],
            { textCoordinate, zoneText },
          ];
        } else {
          tempObj[JSON.stringify(style)] = [{ textCoordinate, zoneText }];
        }
      }
      // Each of these keys has multiple zones with different styles
      const key = {
        articleID,
        color,
        coordinates,
      };
      // We need all of those different styles as key and value as array of zones with those style
      article_segregation[JSON.stringify(key)] = tempObj;
    }
  }
  // let articleMap = new Map();
  // for (let [key, article] of Object.entries(articleCollection)) {
  //   const newMap = new Map();
  //   for (let article_obj of article.ArticleJson) {
  //     const { articleID, color, coordinates } = article;
  //     const { zoneText, coordinates: textCoordinate } = article_obj;
  //     if (article_obj.Tag === "Image") {
  //       if (newMap.get("Image")) {
  //         const imageArr = newMap.get("Image");
  //         imageArr.push({ imageCoordinates: textCoordinate });
  //         newMap.set("Image", imageArr);
  //       } else {
  //         newMap.set("Image", [{ imageCoordinates: textCoordinate, zoneText }]);
  //       }
  //     } else {
  //       const { name: qwe = "", ...style } = article_obj.style ?? {};
  //       if (newMap.get(style)) {
  //         const contentArr = newMap.get(JSON.stringify(style));
  //         contentArr.push({ textCoordinate, zoneText });
  //         newMap.set(JSON.stringify(style), contentArr);
  //       } else {
  //         newMap.set(JSON.stringify(style), [{ textCoordinate, zoneText }]);
  //       }
  //     }
  //     // Each of these keys has multiple zones with different styles
  //     const key = {
  //       articleID,
  //       color,
  //       coordinates,
  //     };
  //     // We need all of those different styles as key and value as array of zones with those style
  //     articleMap.set(JSON.stringify(key), newMap);
  //   }
  // }
  let article_segregation_2 = {};

  const getParent = (arr, idx) => {
    const index = ((idx - 1) / 2) | 0;
    return { value: arr[index].val, index };
  };
  const swap = (arr, idxFrom, idxTo) => {
    const temp = arr[idxFrom];
    arr[idxFrom] = arr[idxTo];
    arr[idxTo] = temp;
    return arr;
  };
  const largestChild = (left, right) => {
    if (!right.node) return left.node;
    left ? left.node.val > right.node.val : right;
  };
  const children = (arr, idx) => {
    const left_idx = 2 * idx + 1;
    const right_idx = 2 * idx + 2;
    return {
      left: { node: arr[left_idx], index: left_idx },
      right: { node: arr[right_idx], index: right_idx },
    };
  };
  const insertItem = (arr, obj) => {
    let pos = arr.length;
    arr.push(obj);
    if (pos === 0) return arr;
    while (arr[pos].val > getParent(arr, pos).value) {
      parent_pos = getParent(arr, pos).index;
      arr = swap(arr, pos, parent_pos);
      pos = parent_pos;
    }
    return arr;
  };
  const getItem = (arr) => {
    const first_item = arr[0];
    // last item becames first
    const last_item = arr.pop();
    arr[0] = last_item;
    let pos = 0;
    while (
      arr[pos].val <
      largestChild(children(arr, pos).left, children(arr, pos).right)
    ) {
      const maxChild = largestChild(
        children(arr, pos).left,
        children(arr, pos).right
      );
      arr = swap(arr, pos, maxChild.index);
      pos = maxChild.index;
    }
    return first_item;
  };
  for (let [key, value] of Object.entries(
    JSON.parse(JSON.stringify(article_segregation))
  )) {
    // content with maximum characters will be stored in below variable
    let maxLength = { key: "unknown", length: -Infinity };
    // content with single letter will be stored in below variable
    let oneLetter = [];
    // content with maximum font size will be stored in below variable
    let maxFontSize = { key: "unknown", size: -Infinity };

    // array of font sizes
    let fontSizes = [],
      // array of number of characters
      characterLengths = [];

    for (let [style, contentArr] of Object.entries(value)) {
      if (style === "Image" || style === "textContents") {
        article_segregation_2[key] = contentArr;
      } else {
        const text_style = JSON.parse(style);
        // const { color, size, weight, italic, serif } = style;
        const { size, weight } = text_style;
        if (!(contentArr.length === 1 && contentArr[0].zoneText.length === 1))
          fontSizes = insertItem(fontSizes, { style, val: size });

        if (size > maxFontSize.size) {
          if (!(contentArr.length === 1 && contentArr[0].zoneText.length === 1))
            maxFontSize = { key: style, size };
        }
        let local_length = 0;
        for (let content of contentArr) {
          if (content.zoneText.length === 1) {
            oneLetter.push({ content, style });
          }
          local_length += content.zoneText.length;
        }
        characterLengths = insertItem(characterLengths, {
          val: local_length,
          style,
        });
        if (maxLength.length < local_length) {
          maxLength.key = style;
          maxLength.length = local_length;
        }
      }
    }
    if (characterLengths.length === 0) continue;
    const tagged = new Set();
    // while (fontSizes.length !== 0) {
    //   temp_arr.push(getItem(fontSizes));
    // }
    let temp = article_segregation[key];
    const highestCharacter = getItem(characterLengths).style;
    temp.body = temp[highestCharacter];
    tagged.add(highestCharacter);
    delete temp[highestCharacter];
    if (oneLetter.length !== 0) {
      for (let letter of oneLetter) {
        temp.body.push(letter.content);
        delete temp[letter.style];
      }
    }
    let largestFontSize = getItem(fontSizes).style;
    // while (tagged.has(largestFontSize)) {
    //   largestFontSize = getItem(fontSizes).style;
    // }
    temp.title = temp[largestFontSize];
    tagged.add(largestFontSize);
    delete temp[largestFontSize];
    article_segregation_2[key] = temp;
  }
  for (let [key, article_zone] of Object.entries(article_segregation_2)) {
    for (let [style, text_zone_arr] of Object.entries(article_zone)) {
      textZone = [];
      if (
        style === "Image" ||
        style === "textContents" ||
        text_zone_arr == null
      )
        continue;
      // Merging article body(zones with same width and if there touch or overlap)
      i = 0;
      let j = 1;
      while (j < text_zone_arr.length) {
        const zone = new Map(Object.entries(text_zone_arr[i].textCoordinate));
        const nextZone = new Map(
          Object.entries(text_zone_arr[j].textCoordinate)
        );
        const cond = (i, j) => {
          if (text_zone_arr[j] == null) return false;
          const isOverlapping = CartesianThings.isOverlappingOrTouching_approx(
            new Map(Object.entries(text_zone_arr[i].textCoordinate)),
            new Map(Object.entries(text_zone_arr[j].textCoordinate))
          );
          return (
            text_zone_arr[i].textCoordinate.x1 -
              text_zone_arr[j].textCoordinate.x1 <=
              1 &&
            text_zone_arr[i].textCoordinate.x2 -
              text_zone_arr[j].textCoordinate.x2 <=
              1 &&
            isOverlapping
          );
        };
        if (cond(i, j)) {
          while (cond(j, j + 1)) {
            j++;
          }
          const newZone = CartesianThings.mergeBox(
            new Map(Object.entries(text_zone_arr[i].textCoordinate)),
            new Map(Object.entries(text_zone_arr[j].textCoordinate))
          );
          let newContent = [];
          for (let idx = i; idx <= j; idx++)
            newContent.push(text_zone_arr[idx].zoneText);
          const reqData = {
            textCoordinate: Object.fromEntries(newZone),
            zoneText: newContent.join("\n"),
            tag: style,
          };
          newZone.set("content", newContent.join("\n"));

          textZone.push(reqData);
          i = j + 1;
          j = i + 1;
        } else {
          textZone.push({ ...text_zone_arr[i], tag: style });
          i++;
          j++;
        }
      }
      textZone.push({ ...text_zone_arr[i], tag: style });
      // Merge Completed
      article_segregation_2[key][style] = textZone;
    }
  }
  const reqArr = [];
  // for (let article in articleCollection)
  //   reqArr.push(articleCollection[article]);
  for (let [key, value] of Object.entries(article_segregation_2)) {
    const articleZone = JSON.parse(key);
    const ArticleJson = [];
    for (let [tag, zone] of Object.entries(value)) {
      if (zone == null) continue;
      for (let data of zone) {
        const reqData = {
          zoneText: data.zoneText,
          coordinates: data.textCoordinate ?? data.imageCoordinates,
          Tag: tag,
        };
        ArticleJson.push(reqData);
      }
    }
    reqArr.push({ ...articleZone, ArticleJson });
  }
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
