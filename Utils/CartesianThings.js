/**
 * Returns true/false depending on whether the image is overlapping
 * @param {*} rect_1
 * @param {*} rect_2
 * @returns
 */
exports.isOverlapping = (rect_1, rect_2) => {
  if (
    rect_1.get("x1") >= rect_2.get("x2") ||
    rect_1.get("x2") <= rect_2.get("x1") ||
    rect_1.get("y1") >= rect_2.get("y2") ||
    rect_1.get("y2") <= rect_2.get("y1")
  )
    return false;
  console.log(rect_1.get("name"), "and", rect_2.get("name"), "are overlapping");
  return true;
};

/**
 * Returns true/false depending on whether the image is overlapping or touching
 * @param {*} rect_1
 * @param {*} rect_2
 * @returns
 */
exports.isOverlappingOrTouching_approx = (rect_1, rect_2) => {
  if (
    (rect_1.get("x1") | 0) > ((rect_2.get("x2") + 1) | 0) ||
    ((rect_1.get("x2") + 1) | 0) < (rect_2.get("x1") | 0) ||
    (rect_1.get("y1") | 0) > ((rect_2.get("y2") + 1) | 0) ||
    ((rect_1.get("y2") + 1) | 0) < (rect_2.get("y1") | 0)
  )
    return false;
  console.log(rect_1.get("name"), "and", rect_2.get("name"), "are overlapping");
  return true;
};
/**
 * Returns true/false depending on whether the image is overlapping or touching
 * @param {*} rect_1
 * @param {*} rect_2
 * @returns
 */
exports.isOverlappingOrTouching = (rect_1, rect_2) => {
  if (
    (rect_1.get("x1") | 0) > (rect_2.get("x2") | 0) ||
    (rect_1.get("x2") | 0) < (rect_2.get("x1") | 0) ||
    (rect_1.get("y1") | 0) > (rect_2.get("y2") | 0) ||
    (rect_1.get("y2") | 0) < (rect_2.get("y1") | 0)
  )
    return false;
  console.log(rect_1.get("name"), "and", rect_2.get("name"), "are overlapping");
  return true;
};

/**
 * Returns a Map with merged coordinates
 * @param {*} rect_1
 * @param {*} rect_2
 * @returns
 */
exports.mergeBox = (rect_1, rect_2) => {
  const x1 = Math.min(rect_1.get("x1"), rect_2.get("x1"));
  const x2 = Math.max(rect_1.get("x2"), rect_2.get("x2"));
  const y1 = Math.min(rect_1.get("y1"), rect_2.get("y1"));
  const y2 = Math.max(rect_1.get("y2"), rect_2.get("y2"));
  const temp = new Map(rect_1);
  temp.set("x1", x1);
  temp.set("y1", y1);
  temp.set("x2", x2);
  temp.set("y2", y2);
  return temp;
};

/**
 * Gets cartesian coordinates of a box
 * Returns an array of two values representing x and y which is the box's center
 * @param {*} box
 * @returns
 */
exports.centerOf = (box) => [
  (box.get("x1") + box.get("x2")) / 2,
  (box.get("y1") + box.get("y2")) / 2,
];

/**
 * Returns whether the point is inside the box
 * @param {*} point x,y that represents a point in cartesian coordinate
 * @param {*} box an Object containing x1,y1 and x2,y2 that represents a box
 * @returns Boolean value
 */
exports.isContainedWitinin = (point, box) => {
  const x1 = box.get("x1");
  const x2 = box.get("x2");
  const y1 = box.get("y1");
  const y2 = box.get("y2");
  const [px, py] = point;
  if (x1 <= px && px <= x2 && y1 <= py && py <= y2) return true;
  else return false;
};
