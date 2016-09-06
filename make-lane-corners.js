// packages
var fs = require('fs');
var mathjs = require('mathjs');
var svgBuilder = require('svg-builder');

// constants
const CANVAS_WIDTH = 1500;
const CANVAS_HEIGHT = 1500;
const CANVAS_SCALE = 1500*1000;
const NAME_COL = 0;
const LAT_COL = 1;
const LON_COL = 2;
const STOP_COL = 5;
const LANE_FACTOR = 5000;
const ROUTE_COLOURS = {
  'AK-01': 'blue',
  'AK-02': 'orange',
  'AK-03': 'blue',
  'AK-04': 'blue',
  'AK-05': 'lightpurple',
  'AK-06': 'yellow',
  'AK-07': 'lightgrey',
  'AK-08': 'red',
  'AK-09': 'purple',
  'AK-10': 'silver',
  'AK-11': 'brown',
  'AK-12': 'yellow',
  'AK-13': 'orange',
  'AK-14': 'pink',
  'AK-15': 'lightbrown',
  'AK-16': 'lightgrey',
  'AK-17': 'black',
  'AK-18': 'black',
  'AK-19': 'black',
  'AK-20': 'black',
  'AK-21': 'black',
  'AK-22': 'black',
  'AK-23': 'black',
};

// globals
var svg = svgBuilder.width(CANVAS_WIDTH).height(CANVAS_HEIGHT);
var routes = {};
var cornerPoints = {};

// functions
function warp(x) {
  return x/100;
  //:
  if (x<0) {
    return -Math.sqrt(Math.abs(x));
  } else {
    return Math.sqrt(x);
  }
}

function toCanvas(lon, lat) {
  // center around (-6.6, 106.8) which is right in the Kebun Raya (Bogor, Indonesia).
  var x = parseFloat(lat) - 106.8;
  var y = parseFloat(lon) + 6.6;

  var centerX = 3.2; // <2 means down, >2 means up
  var centerY = 2.6; // <2 means right, >2 means left
  var canvasX = (CANVAS_WIDTH/centerX)+warp(CANVAS_SCALE*x);
  var canvasY = (CANVAS_HEIGHT/centerY)-warp(CANVAS_SCALE*y);
  // console.log('returning', lon, lat, canvasX, canvasY);
  return [canvasX, canvasY];
}

function drawLine(routeName, fromLonLat, toLonLat) {
  var [x1, y1] = toCanvas(fromLonLat);
  var [x2, y2] = toCanvas(toLonLat);
  var line = {
    stroke: ROUTE_COLOURS[routeName],
    'stroke-width': 40,
    x1, y1, x2, y2,
  }
  svg.line(line);
}

function readPoints() {
  var firstLine = true;
  fs.readFileSync('./manual-from-transitwand/kota/shapes.txt').toString().split('\n').map(line => {
    if (firstLine) {
      firstLine = false;
      return;
    }
    var columns = line.split(',');
    if (columns.length < 5) {
      return;
    }
    if (typeof routes[columns[NAME_COL]] === 'undefined') {
      routes[columns[NAME_COL]] = [];
    }
    routes[columns[NAME_COL]].push([
      parseFloat(columns[LAT_COL]),
      parseFloat(columns[LON_COL]),
  //    columns[STOP_COL],
    ]);
  });
}

function assignLanes() {
  var numLanes = {};
  for (var routeName in routes) {
    for (var i=0; i<routes[routeName].length; i++) {
      var stretchDef = [
        routes[routeName][i][0],
        routes[routeName][i][1],
        routes[routeName][(i+1) % routes[routeName].length][0],
        routes[routeName][(i+1) % routes[routeName].length][1],
      ].join(',');
      if (typeof numLanes[stretchDef] === 'undefined') {
        numLanes[stretchDef] = 0;
      }
      var lane = ++numLanes[stretchDef];
      // to each point, add the lane to be used after that point
      routes[routeName][i].push(lane);
    }
  }
}

function perpendicularVector(fromX, fromY, toX, toY) {
  var distance = mathjs.distance([fromX, fromY], [toX, toY]);
  if (distance === 0) {
    return [0, 0];
  }
  var normalized = [(toX-fromX)/(LANE_FACTOR*distance), (toY-fromY)/(LANE_FACTOR*distance)];
  // I would have thought this should be:
  // return [-normalized[1], normalized[0]];
  // to make the angkots drive on the left
  // side of the road, but apparently
  // when looking at the result,
  // (-, +) makes them drive on the right
  // side and (+, -) makes them drive on
  // the left:
  return [normalized[1], -normalized[0]];
}

function lineThrough(a, b) {
  //console.log('line through', a, b);
  var numLanes = a[2];
  var laneVector = perpendicularVector(a[0], a[1], b[0], b[1]);
  var fromX = a[0] + numLanes * laneVector[0];
  var fromY = a[1] + numLanes * laneVector[1];
  var toX = b[0] + numLanes * laneVector[0];
  var toY = b[1] + numLanes * laneVector[1];
  // two points define a line
  //      fix x, var x,    fix y, var y
  return [fromX, toX-fromX, fromY, toY-fromY];
}

function cutLines(a, b) {
  // x = a[0] + a[1]*k = b[0] + b[1]*l
  // move terms  a[1]*k = b[0] + b[1]*l - a[0]
  // divide      k = (b[0] + b[1]*l - a[0]) / a[1]
  // y = a[2] + a[3]*(         k           ) = b[2] + b[3]*l
  // fill in k   a[2] + a[3]*(b[0]+b[1]*l-a[0])/a[1] = b[2] + b[3]*l
  // move terms  a[3]*(b[0]+b[1]*l-a[0])/a[1] - b[3]*l = b[2] - a[2]
  // divide            b[0]+b[1]*l-a[0] - b[3]*l/(a[3]/a[1]) = (b[2] - a[2])/(a[3]/a[1])
  // group terms       b[0] - a[0] + b[1]*l - (b[3]/(a[3]/a[1]))*l = (b[2]-a[2])/(a[3]/a[1])
  // move terms                      b[1]*l - (b[3]/(a[3]/a[1]))*l = (b[2]-a[2])/(a[3]/a[1]) - b[0] + a[0]
  // group terms                    (b[1]   - (b[3]/(a[3]/a[1]))) * l =  (b[2]-a[2])/(a[3]/a[1]) - b[0] + a[0]
  // divide                                                         l = ((b[2]-a[2])/(a[3]/a[1]) - b[0] + a[0]) / (b[1]   - (b[3]/(a[3]/a[1])))
  var l = ((b[2]-a[2])/(a[3]/a[1]) - b[0] + a[0]) / (b[1]   - (b[3]/(a[3]/a[1])));
  // x = b[0] + b[1]*l = a[0] + a[1]*k
  // move terms  b[1]*l = a[0] + a[1]*k - b[0]
  // divide      l = (a[0] + a[1]*k - b[0]) / b[1]
  // y = b[2] + b[3]*(         l           ) = a[2] + a[3]*k
  // fil in l   b[2] + b[3]*(a[0]+a[1]*k-b[0])/b[1] = a[2] + a[3]*k
  // move terms  b[3]*(a[0]+a[1]*k-b[0])/b[1] - a[3]*k = a[2] - b[2]
  // divide            a[0]+a[1]*k-b[0] - a[3]*k/(b[3]/b[1]) = (a[2] - b[2])/(b[3]/b[1])
  // group terms       a[0] - b[0] + a[1]*k - (a[3]/(b[3]/b[1]))*k = (a[2]-b[2])/(b[3]/b[1])
  // move terms                      a[1]*k - (a[3]/(b[3]/b[1]))*k = (a[2]-b[2])/(b[3]/b[1]) - a[0] + b[0]
  // group terms                    (a[1]   - (a[3]/(b[3]/b[1]))) * k =  (a[2]-b[2])/(b[3]/b[1]) - a[0] + b[0]
  // divide                                                         k = ((a[2]-b[2])/(b[3]/b[1]) - a[0] + b[0]) / (a[1]   - (a[3]/(b[3]/b[1])))
  var k = ((a[2]-b[2])/(b[3]/b[1]) - a[0] + b[0]) / (a[1]   - (a[3]/(b[3]/b[1])));
  var x = b[0] + b[1]*l;
  var y = b[2] + b[3]*l;
  if (isNaN(x) || isNaN(y)) {
    x = a[0] + a[1]*k;
    y = a[2] + a[3]*k;
  }
  if (isNaN(x) || isNaN(y)) {
    var finishXA = a[0]+a[1];
    var finishYA = a[2]+a[3];
    var startXB = b[0];
    var startYB = b[2];
    var x = (finishXA + startXB)/2;
    var y = (finishYA + startYB)/2;
  }
  return [x, y];
}

function makeCornerPoint(routeName, before, here, after) {
  var beforeLine = lineThrough(before, here);
  var afterLine = lineThrough(here, after);
  return cutLines(beforeLine, afterLine);
}

function traceRoute(routeName) {
  var cornerPoints = [];
  var points = routes[routeName];
  for (var i=0; i<points.length; i++) {
    cornerPoints.push(makeCornerPoint(
      routeName,
      points[i],
      points[(i+1) % points.length],
      points[(i+2) % points.length]));
  }
  for (var i=0; i<cornerPoints.length; i++) {
    drawLine(routeName,
      cornerPoints[i],
      cornerPoints[(i+1)%cornerPoints.length]);
  }
}

readPoints();
assignLanes();
for (var routeName in routes) {
  traceRoute(routeName);
}

fs.writeFileSync('./release/map.svg', svg.render());