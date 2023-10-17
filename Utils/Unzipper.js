const AdmZip = require("adm-zip");
const zlib = require("zlib");

const unzipFile = (zipBuffer) => {
  const zip = new AdmZip(zipBuffer);

  // List the entries (files) in the zip archive
  const zipEntries = zip.getEntries();
  const data = { directories: [], files: [] };

  zipEntries.forEach((entry) => {
    if (entry.isDirectory) {
      data.directory.push({
        name: entry.entryName,
        data: zip.readFile(entry),
      });
      console.log(`Directory: ${entry.entryName}`);
    } else {
      data.files.push({ name: entry.entryName, data: zip.readFile(entry) });
      console.log(`File: ${entry.entryName}`);
    }
  });
  return data;
};

const vanillaJSUnzip = () => {
  zlib.unzip(buffer, (err, buffer) => {
    if (err) console.log("err: ", err);
    // else console.log(buffer.toString("base64"));
    else {
      const files = fs.readdirSync(buffer, { withFileTypes: true });
      fileObjs.forEach((file) => {
        console.log(file);
      });
    }
  });
};

module.exports = unzipFile;
