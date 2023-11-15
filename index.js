const fs = require("fs");
const axios = require("axios");
const util = require("util");
const parseString = util.promisify(require("xml2js").parseString);
const { PDFNet } = require("@pdftron/pdfnet-node");
const path = require("path");

// Local files
const imageExtract = require("./Utils/imageExtract");
const unzipper = require("./Utils/Unzipper");
const CartesianThings = require("./Utils/CartesianThings");
const colorArr = require("./Utils/colors");

const demo = process.env.demo;
let pageHeight;

const directoryPath = path.join(__dirname, "PDF_FILE");
const pdfFileName = fs.readdirSync(directoryPath)[0];
const pdfFilePath = path.join(directoryPath, pdfFileName);
const smartZoneAPI_path = "F:\\Zone Stellar\\smart_zone_api\\public\\test.pdf";

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
    // const contentType = res.headers["content-type"];
    // console.log("contentType: ", contentType);

    let buffer = Buffer.from(res.data);
    if (demo) {
      fs.writeFile(`${__dirname}/articleZone.zip`, buffer, (err) => {
        if (err) {
          console.log("err: ", err);
        } else console.log("Article Zoning Success");
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
    // const contentType = res.headers["content-type"];
    // console.log("contentType: ", contentType);

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
  const originalFile = fs.readFileSync(path);
  const doc = await PDFNet.PDFDoc.createFromFilePath(path);
  doc.initSecurityHandler();
  const itr = await doc.getPageIterator();
  const curPage = await itr.current();
  var pageHeight = await curPage.getPageHeight();
  return { originalFile, pageHeight };
};

const copyFile2SmartZoner = (sz_path) => {
  fs.copyFile(pdfFilePath, sz_path, (err) => {
    console.log("err: ", err);
  });
};

const imagesInPDF = async () => {
  // Image Extraction
  let imgArr = await imageExtract(
    pdfFilePath,
    `${__dirname}/Images/`,
    pageHeight
  );

  // # 1. create present image, i and j for index, i =0 & j=1+1
  // # 2. assign present image to arr[i]
  // # 3. Loop through the array from j= i+1 to j = length of array -1
  // # 3. compare present image with arr[j]
  // #  a. if they should merge,
  // #     i) merge the image and overwrite the present image
  // #    ii) mark deleted to the jth image
  // #   iii) reassign j=i+1, if arr[i+1] has deleted true, increment till deleted is false
  // #    iv) continue the loop such that present imagae is compared with j
  // # b. if they should not merge,
  // #    increment the j and carry on
  // # Finally an array with combination of merged images, deleted images, untouched images will the there
  // # Remove the deleted images

  let i = 0,
    j = 1;
  while (i < imgArr.length - 1) {
    while (imgArr[i].get("deleted")) i++;
    let presentImg = imgArr[i];
    j = i + 1;
    while (j < imgArr.length - 1) {
      const compareImg = imgArr[j];
      const centerofPresentImg = CartesianThings.centerOf(presentImg);
      const centerofCompareImg = CartesianThings.centerOf(compareImg);

      // FIS => "First Inside Second"
      const FIS = CartesianThings.isContainedWitinin(
        centerofPresentImg,
        compareImg
      );

      // SIF => "Second Inside First"
      const SIF = CartesianThings.isContainedWitinin(
        centerofCompareImg,
        presentImg
      );

      // Checking if image's center is inside the other image
      if (FIS || SIF) {
        const mergedImage = CartesianThings.mergeBox(presentImg, compareImg);
        presentImg = mergedImage;
        imgArr[j].set("deleted", true);
        j += 1;
        while (imgArr[j].get("deleted")) j++;
      } else j++;
    }
    i++;
  }

  imgArr = imgArr
    .filter((img) => !img.get("deleted"))
    .map((img) => img.set("Tag", "Image"));

  // ImgArr contains the required image information
  return imgArr;
};

const surfaceZoneArray = (xfdfData) => {
  // Surface zones
  let zones = [];

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
  return zones;
};

const articleZoneArray = (textContents, imgArr) => {
  let tempTextZone = [];
  // Merging lines zones to a complete para zones
  for (let segment of textContents.pages[0].elements) {
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity,
      content = "",
      style;
    // Type would probably be Table if segment.kids is undefined
    if (segment.type === "table") {
      const tableImage = new Map();
      tableImage.set("Tag", "Image");
      tableImage.set("name", `Table_${imgArr.length + 1}`);
      tableImage.set("x1", segment.rect[0]);
      tableImage.set("y1", pageHeight - segment.rect[3]);
      tableImage.set("x2", segment.rect[2]);
      tableImage.set("y2", pageHeight - segment.rect[1]);

      imgArr.push(tableImage);
      continue;
    }
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
  // Merge Completed
  return tempTextZone;
};

const main = async () => {
  await PDFNet.initialize(
    "demo:kishore.k@harnstech.com:7abe10f00200000000ab2ff8f0e2d8d969089ccb724506a23f33470aeb"
  );

  const { originalFile: file, pageHeight: fromAPI } = await getPdf(pdfFilePath);
  pageHeight = fromAPI;
  // Image Extraction
  let imgArr = imagesInPDF();

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
  const xfdfData = await parseString(reqFile.xfdf.data);
  let zones = surfaceZoneArray(xfdfData);

  // Article Zones
  let textContents = Buffer.from(reqFile.json.data);
  textContents = textContents.toString("utf-8");
  textContents = JSON.parse(textContents);

  let textZone = articleZoneArray(textContents, imgArr);

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
  let unTaggedExists = false;
  let unTagged = [];
  textZone = textZone.map((item) => {
    if (!item.get("tagged")) {
      unTaggedExists = true;
      unTagged.push(Object.fromEntries(item));
      const temp = new Map(item);
      temp.set("tagged", true);
      temp.set("taggedTo", "unknown...👻");
      return temp;
    }
    return item;
  });
  fs.writeFileSync(
    `${__dirname}/unTagged.txt`,
    JSON.stringify(unTagged),
    (err) => {
      console.log("err: ", err);
    }
  );

  imgArr = imgArr.map((item) => {
    if (!item.get("tagged")) {
      unTaggedExists = true;
      const temp = new Map(item);
      temp.set("tagged", true);
      temp.set("taggedTo", "unknown...👻");
      return temp;
    }
    return item;
  });

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
    } else articleCollection[`article_no:${img.get("taggedTo")}`].push(reqData);
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
  if (unTaggedExists)
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
  //- let articleMap = new Map();
  //- for (let [key, article] of Object.entries(articleCollection)) {
  //-   const newMap = new Map();
  //-   for (let article_obj of article.ArticleJson) {
  //-     const { articleID, color, coordinates } = article;
  //-     const { zoneText, coordinates: textCoordinate } = article_obj;
  //-     if (article_obj.Tag === "Image") {
  //-       if (newMap.get("Image")) {
  //-         const imageArr = newMap.get("Image");
  //-         imageArr.push({ imageCoordinates: textCoordinate });
  //-         newMap.set("Image", imageArr);
  //-       } else {
  //-         newMap.set("Image", [{ imageCoordinates: textCoordinate, zoneText }]);
  //-       }
  //-     } else {
  //-       const { name: qwe = "", ...style } = article_obj.style ?? {};
  //-       if (newMap.get(style)) {
  //-         const contentArr = newMap.get(JSON.stringify(style));
  //-         contentArr.push({ textCoordinate, zoneText });
  //-         newMap.set(JSON.stringify(style), contentArr);
  //-       } else {
  //-         newMap.set(JSON.stringify(style), [{ textCoordinate, zoneText }]);
  //-       }
  //-     }
  //-     // Each of these keys has multiple zones with different styles
  //-     const key = {
  //-       articleID,
  //-       color,
  //-       coordinates,
  //-     };
  //-     // We need all of those different styles as key and value as array of zones with those style
  //-     articleMap.set(JSON.stringify(key), newMap);
  //-   }
  //- }

  let article_segregation_2 = {};
  // segregation_2 changes the raw style to it's tag type
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
    // Handling untagged articles
    const { articleID } = JSON.parse(key);
    if (articleID === "unknown") {
      article_segregation_2[key] = value;
      continue;
    }
    // content with single letter will be stored in below variable
    let oneLetter = [];

    // array of font sizes
    let fontSizes = [],
      // array of number of characters
      characterLengths = [];

    for (let [style, contentArr] of Object.entries(value)) {
      if (style === "Image") {
        article_segregation_2 = {
          ...article_segregation_2,
          // [key]: { [style]: contentArr },
          [key]: { Image: contentArr },
        };
      } else {
        const text_style = JSON.parse(style);
        // const { color, size, weight, italic, serif } = style;
        const { size, weight } = text_style;
        if (!(contentArr.length === 1 && contentArr[0].zoneText.length === 1))
          fontSizes = insertItem(fontSizes, { style, val: size });

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
        const toMap = (zone, idx) => {
          let theMap = new Map();
          theMap.set("index", idx);
          theMap.set(
            "x1",
            zone.textCoordinate?.x1 ?? zone.content.textCoordinate.x1
          );
          theMap.set(
            "y1",
            zone.textCoordinate?.y1 ?? zone.content.textCoordinate.y1
          );
          theMap.set(
            "y2",
            zone.textCoordinate?.y2 ?? zone.content.textCoordinate.y2
          );
          theMap.set(
            "x2",
            zone.textCoordinate?.x2 ?? zone.content.textCoordinate.x2
          );
          theMap.set("zoneText", zone?.zoneText ?? zone.content.zoneText);
          if (zone.style) theMap.set("style", zone.style);
          return theMap;
        };
        const letterMap = toMap(letter);
        const bodyMaps = temp.body.map((item, idx) => toMap(item, idx));
        const probableFits = CartesianThings.probableFirstLetterMatches(
          letterMap,
          bodyMaps
        );
        const mostProbableFit = probableFits[0];
        if (mostProbableFit == null) continue;
        const new_content =
          letter.content.zoneText + mostProbableFit.get("zoneText");
        const new_zone = CartesianThings.mergeBox(letterMap, mostProbableFit);
        const mergedIndex = mostProbableFit.get("index");
        // const new_content = letter.content.zoneText + temp.body[0].zoneText;
        // const new_zone = CartesianThings.mergeBox(
        //   new Map(Object.entries(letter.content.textCoordinate)),
        //   new Map(Object.entries(temp.body[0].textCoordinate))
        // );
        new_zone.delete("index");
        new_zone.delete("style");
        new_zone.delete("zoneText");
        temp.body.splice(mergedIndex, 1, {
          textCoordinate: Object.fromEntries(new_zone),
          zoneText: new_content,
        });
        // temp.body.push(letter.content);
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

  // TODO:
  // In each style, check if there is a content with just one letter
  // If yes, check for zones that itercepts and then merge the firstletter with body
  // 2 approaches, check for zones that itercepts on right side - so first letter will be merged as it is suppose to
  // or merge it and then check for overlapping and merge zones that overlap - entire content will be merged and then dupilate part will be removed
  // -------------------------

  // Merge sytle values that overlap
  // Loop entirely or sort based on distance and then use the below approach
  for (let [key, article_zone] of Object.entries(article_segregation_2)) {
    for (let [style, text_zone_arr] of Object.entries(article_zone)) {
      textZone = [];
      const { articleID } = JSON.parse(key);
      if (
        articleID === "unknown" ||
        style === "Image" ||
        //  For undefined title
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
            // // Check if they are of same width-----
            // text_zone_arr[i].textCoordinate.x1 -
            // text_zone_arr[j].textCoordinate.x1 <=
            // 1 &&
            // text_zone_arr[i].textCoordinate.x2 -
            // text_zone_arr[j].textCoordinate.x2 <=
            // 1 &&
            // // ----------------------------------
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
      if (i < text_zone_arr.length)
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
  copyFile2SmartZoner(smartZoneAPI_path);
};

main();
