(function() {(window.nunjucksPrecompiled = window.nunjucksPrecompiled || {})["current.njk"] = (function() {
function root(env, context, frame, runtime, cb) {
var lineno = 0;
var colno = 0;
var output = "";
try {
var parentTemplate = null;
var macro_t_1 = runtime.makeMacro(
[], 
[], 
function (kwargs) {
var callerFrame = frame;
frame = new runtime.Frame();
kwargs = kwargs || {};
if (Object.prototype.hasOwnProperty.call(kwargs, "caller")) {
frame.set("caller", kwargs.caller); }
var t_2 = "";t_2 += "\n  ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"humidity")) {
t_2 += "\n    <span class=\"humidity\"\n      ><span>";
t_2 += runtime.suppressValue(env.getFilter("decimalSymbol").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"humidity")), env.opts.autoescape);
t_2 += "</span><sup>&nbsp;<i class=\"wi wi-humidity humidity-icon\"></i></sup\n    ></span>\n  ";
;
}
t_2 += "\n";
;
frame = callerFrame;
return new runtime.SafeString(t_2);
});
context.addExport("humidity");
context.setVariable("humidity", macro_t_1);
output += "\n";
if(runtime.contextOrFrameLookup(context, frame, "current")) {
output += "\n  ";
if(!runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"onlyTemp")) {
output += "\n    <div class=\"normal medium\">\n      <span class=\"wi wi-strong-wind dimmed\"></span>\n      <span>\n        ";
output += runtime.suppressValue(env.getFilter("round").call(context, env.getFilter("unit").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"windSpeed"),"wind")), env.opts.autoescape);
output += "\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showWindDirection")) {
output += "\n          <sup>\n            ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showWindDirectionAsArrow")) {
output += "\n              <i class=\"fas fa-long-arrow-alt-down\" style=\"transform:rotate(";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"windFromDirection"), env.opts.autoescape);
output += "deg)\"></i>\n            ";
;
}
else {
output += "\n              ";
output += runtime.suppressValue(env.getFilter("translate").call(context, (lineno = 18, colno = 46, runtime.callWrap(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"cardinalWindDirection"), "current[\"cardinalWindDirection\"]", context, []))), env.opts.autoescape);
output += "\n            ";
;
}
output += "\n            &nbsp;\n          </sup>\n        ";
;
}
output += "\n      </span>\n      ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showHumidity") === "wind") {
output += "\n        ";
output += runtime.suppressValue((lineno = 25, colno = 19, runtime.callWrap(macro_t_1, "humidity", context, [])), env.opts.autoescape);
output += "\n      ";
;
}
output += "\n      ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showSun") && (lineno = 27, colno = 52, runtime.callWrap(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"nextSunAction"), "current[\"nextSunAction\"]", context, []))) {
output += "\n        <span class=\"wi dimmed wi-";
output += runtime.suppressValue((lineno = 28, colno = 58, runtime.callWrap(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"nextSunAction"), "current[\"nextSunAction\"]", context, [])), env.opts.autoescape);
output += "\"></span>\n        <span>\n          ";
if((lineno = 30, colno = 37, runtime.callWrap(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"nextSunAction"), "current[\"nextSunAction\"]", context, [])) === "sunset") {
output += "\n            ";
output += runtime.suppressValue(env.getFilter("formatTime").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"sunset")), env.opts.autoescape);
output += "\n          ";
;
}
else {
output += "\n            ";
output += runtime.suppressValue(env.getFilter("formatTime").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"sunrise")), env.opts.autoescape);
output += "\n          ";
;
}
output += "\n        </span>\n      ";
;
}
output += "\n      ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showUVIndex")) {
output += "\n        <td class=\"align-right bright uv-index\">\n          <div class=\"wi dimmed wi-hot\"></div>\n          ";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"uvIndex"), env.opts.autoescape);
output += "\n        </td>\n      ";
;
}
output += "\n    </div>\n  ";
;
}
output += "\n  <div class=\"flex large type-temp\">\n    ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showIndoorTemperature") && runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "indoor")),"temperature") || runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showIndoorHumidity") && runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "indoor")),"humidity")) {
output += "\n      <span class=\"medium fas fa-home\"></span>\n      <span style=\"display: inline-block\">\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showIndoorTemperature") && runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "indoor")),"temperature")) {
output += "\n          <sup class=\"small\" style=\"position: relative; display: block; text-align: left;\">\n            <span> ";
output += runtime.suppressValue(env.getFilter("decimalSymbol").call(context, env.getFilter("unit").call(context, env.getFilter("roundValue").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "indoor")),"temperature")),"temperature")), env.opts.autoescape);
output += " </span>\n          </sup>\n        ";
;
}
output += "\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showIndoorHumidity") && runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "indoor")),"humidity")) {
output += "\n          <sub class=\"small\" style=\"position: relative; display: block; text-align: left;\">\n            <span> ";
output += runtime.suppressValue(env.getFilter("decimalSymbol").call(context, env.getFilter("unit").call(context, env.getFilter("roundValue").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "indoor")),"humidity")),"humidity")), env.opts.autoescape);
output += " </span>\n          </sub>\n        ";
;
}
output += "\n      </span>\n    ";
;
}
output += "\n    ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"weatherType")) {
output += "\n      <span class=\"light wi weathericon wi-";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"weatherType"), env.opts.autoescape);
output += "\"></span>\n    ";
;
}
output += "\n    <span class=\"light bright\">";
output += runtime.suppressValue(env.getFilter("decimalSymbol").call(context, env.getFilter("unit").call(context, env.getFilter("roundValue").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"temperature")),"temperature")), env.opts.autoescape);
output += "</span>\n    ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showHumidity") === "temp") {
output += "\n      <span class=\"medium bright\">";
output += runtime.suppressValue((lineno = 66, colno = 45, runtime.callWrap(macro_t_1, "humidity", context, [])), env.opts.autoescape);
output += "</span>\n    ";
;
}
output += "\n  </div>\n  ";
if((runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showFeelsLike") || runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showPrecipitationAmount") || runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showPrecipitationProbability")) && !runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"onlyTemp")) {
output += "\n    <div class=\"normal medium feelslike\">\n      ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showFeelsLike")) {
output += "\n        <span class=\"dimmed\">\n          ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showHumidity") === "feelslike") {
output += "\n            ";
output += runtime.suppressValue((lineno = 74, colno = 23, runtime.callWrap(macro_t_1, "humidity", context, [])), env.opts.autoescape);
output += "\n          ";
;
}
output += "\n          ";
output += runtime.suppressValue(env.getFilter("translate").call(context, "FEELS",{"DEGREE": env.getFilter("decimalSymbol").call(context, env.getFilter("unit").call(context, env.getFilter("roundValue").call(context, (lineno = 76, colno = 59, runtime.callWrap(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"feelsLike"), "current[\"feelsLike\"]", context, []))),"temperature"))}), env.opts.autoescape);
output += "\n        </span>\n        <br />\n      ";
;
}
output += "\n      ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showPrecipitationAmount") && env.getTest("defined").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"precipitationAmount")) === true && !env.getTest("null").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"precipitationAmount")) === true) {
output += "\n        <span class=\"dimmed\"> <span class=\"precipitationLeadText\">";
output += runtime.suppressValue(env.getFilter("translate").call(context, "PRECIP_AMOUNT"), env.opts.autoescape);
output += "</span> ";
output += runtime.suppressValue(env.getFilter("unit").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"precipitationAmount"),"precip",runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"precipitationUnits")), env.opts.autoescape);
output += " </span>\n        <br />\n      ";
;
}
output += "\n      ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showPrecipitationProbability") && env.getTest("defined").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"precipitationProbability")) === true && !env.getTest("null").call(context, runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"precipitationProbability")) === true) {
output += "\n        <span class=\"dimmed\"> <span class=\"precipitationLeadText\">";
output += runtime.suppressValue(env.getFilter("translate").call(context, "PRECIP_POP"), env.opts.autoescape);
output += "</span> ";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "current")),"precipitationProbability"), env.opts.autoescape);
output += "% </span>\n      ";
;
}
output += "\n    </div>\n  ";
;
}
output += "\n  ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showHumidity") === "below") {
output += "\n    <span class=\"medium dimmed\">";
output += runtime.suppressValue((lineno = 90, colno = 43, runtime.callWrap(macro_t_1, "humidity", context, [])), env.opts.autoescape);
output += "</span>\n  ";
;
}
output += "\n";
;
}
else {
output += "\n  <div class=\"dimmed light small\">";
output += runtime.suppressValue(env.getFilter("translate").call(context, "LOADING"), env.opts.autoescape);
output += "</div>\n";
;
}
output += "\n<!-- Uncomment the line below to see the contents of the `current` object. -->\n<!-- <div style=\"word-wrap:break-word\" class=\"xsmall dimmed\">";
output += runtime.suppressValue(env.getFilter("dump").call(context, runtime.contextOrFrameLookup(context, frame, "current")), env.opts.autoescape);
output += "</div> -->\n";
if(parentTemplate) {
parentTemplate.rootRenderFunc(env, context, frame, runtime, cb);
} else {
cb(null, output);
}
;
} catch (e) {
  cb(runtime.handleError(e, lineno, colno));
}
}
return {
root: root
};

})();
})();

(function() {(window.nunjucksPrecompiled = window.nunjucksPrecompiled || {})["forecast.njk"] = (function() {
function root(env, context, frame, runtime, cb) {
var lineno = 0;
var colno = 0;
var output = "";
try {
var parentTemplate = null;
if(runtime.contextOrFrameLookup(context, frame, "forecast")) {
output += "\n  ";
var t_1;
t_1 = env.getFilter("calcNumSteps").call(context, runtime.contextOrFrameLookup(context, frame, "forecast"));
frame.set("numSteps", t_1, true);
if(frame.topLevel) {
context.setVariable("numSteps", t_1);
}
if(frame.topLevel) {
context.addExport("numSteps", t_1);
}
output += "\n  ";
var t_2;
t_2 = 0;
frame.set("currentStep", t_2, true);
if(frame.topLevel) {
context.setVariable("currentStep", t_2);
}
if(frame.topLevel) {
context.addExport("currentStep", t_2);
}
output += "\n  <table class=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"tableClass"), env.opts.autoescape);
output += "\">\n    ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"ignoreToday")) {
output += "\n      ";
var t_3;
t_3 = (lineno = 5, colno = 39, runtime.callWrap(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "forecast")),"splice"), "forecast[\"splice\"]", context, [1]));
frame.set("forecast", t_3, true);
if(frame.topLevel) {
context.setVariable("forecast", t_3);
}
if(frame.topLevel) {
context.addExport("forecast", t_3);
}
output += "\n    ";
;
}
output += "\n    ";
var t_4;
t_4 = (lineno = 7, colno = 36, runtime.callWrap(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "forecast")),"slice"), "forecast[\"slice\"]", context, [0,runtime.contextOrFrameLookup(context, frame, "numSteps")]));
frame.set("forecast", t_4, true);
if(frame.topLevel) {
context.setVariable("forecast", t_4);
}
if(frame.topLevel) {
context.addExport("forecast", t_4);
}
output += "\n    ";
frame = frame.push();
var t_7 = runtime.contextOrFrameLookup(context, frame, "forecast");
if(t_7) {t_7 = runtime.fromIterator(t_7);
var t_6 = t_7.length;
for(var t_5=0; t_5 < t_7.length; t_5++) {
var t_8 = t_7[t_5];
frame.set("f", t_8);
frame.set("loop.index", t_5 + 1);
frame.set("loop.index0", t_5);
frame.set("loop.revindex", t_6 - t_5);
frame.set("loop.revindex0", t_6 - t_5 - 1);
frame.set("loop.first", t_5 === 0);
frame.set("loop.last", t_5 === t_6 - 1);
frame.set("loop.length", t_6);
output += "\n      <tr\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"colored")) {
output += "class=\"colored\"";
;
}
output += "\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"fade")) {
output += "style=\"opacity: ";
output += runtime.suppressValue(env.getFilter("opacity").call(context, runtime.contextOrFrameLookup(context, frame, "currentStep"),runtime.contextOrFrameLookup(context, frame, "numSteps")), env.opts.autoescape);
output += ";\"";
;
}
output += "\n      >\n        ";
if((runtime.contextOrFrameLookup(context, frame, "currentStep") == 0) && runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"ignoreToday") == false && runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"absoluteDates") == false) {
output += "\n          <td class=\"day\">";
output += runtime.suppressValue(env.getFilter("translate").call(context, "TODAY"), env.opts.autoescape);
output += "</td>\n        ";
;
}
else {
if((runtime.contextOrFrameLookup(context, frame, "currentStep") == 1) && runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"ignoreToday") == false && runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"absoluteDates") == false) {
output += "\n          <td class=\"day\">";
output += runtime.suppressValue(env.getFilter("translate").call(context, "TOMORROW"), env.opts.autoescape);
output += "</td>\n        ";
;
}
else {
output += "\n          <td class=\"day\">";
output += runtime.suppressValue((lineno = 18, colno = 42, runtime.callWrap(runtime.memberLookup((runtime.memberLookup((t_8),"date")),"format"), "f[\"date\"][\"format\"]", context, [runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"forecastDateFormat")])), env.opts.autoescape);
output += "</td>\n        ";
;
}
;
}
output += "\n        <td class=\"bright weather-icon\">\n          <span class=\"wi weathericon wi-";
output += runtime.suppressValue(runtime.memberLookup((t_8),"weatherType"), env.opts.autoescape);
output += "\"></span>\n        </td>\n        <td class=\"align-right bright max-temp\">";
output += runtime.suppressValue(env.getFilter("decimalSymbol").call(context, env.getFilter("unit").call(context, env.getFilter("roundValue").call(context, runtime.memberLookup((t_8),"maxTemperature")),"temperature")), env.opts.autoescape);
output += "</td>\n        <td class=\"align-right min-temp\">";
output += runtime.suppressValue(env.getFilter("decimalSymbol").call(context, env.getFilter("unit").call(context, env.getFilter("roundValue").call(context, runtime.memberLookup((t_8),"minTemperature")),"temperature")), env.opts.autoescape);
output += "</td>\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showPrecipitationAmount")) {
output += "\n          <td class=\"align-right bright precipitation-amount\">";
output += runtime.suppressValue(env.getFilter("unit").call(context, runtime.memberLookup((t_8),"precipitationAmount"),"precip",runtime.memberLookup((t_8),"precipitationUnits")), env.opts.autoescape);
output += "</td>\n        ";
;
}
output += "\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showPrecipitationProbability")) {
output += "\n          <td class=\"align-right bright precipitation-prob\">";
output += runtime.suppressValue(env.getFilter("unit").call(context, runtime.memberLookup((t_8),"precipitationProbability"),"precip","%"), env.opts.autoescape);
output += "</td>\n        ";
;
}
output += "\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showUVIndex")) {
output += "\n          <td class=\"align-right dimmed uv-index\">\n            ";
output += runtime.suppressValue(runtime.memberLookup((t_8),"uvIndex"), env.opts.autoescape);
output += "\n            <span class=\"wi dimmed weathericon wi-hot\"></span>\n          </td>\n        ";
;
}
output += "\n      </tr>\n      ";
var t_9;
t_9 = runtime.contextOrFrameLookup(context, frame, "currentStep") + 1;
frame.set("currentStep", t_9, true);
if(frame.topLevel) {
context.setVariable("currentStep", t_9);
}
if(frame.topLevel) {
context.addExport("currentStep", t_9);
}
output += "\n    ";
;
}
}
frame = frame.pop();
output += "\n  </table>\n";
;
}
else {
output += "\n  <div class=\"dimmed light small\">";
output += runtime.suppressValue(env.getFilter("translate").call(context, "LOADING"), env.opts.autoescape);
output += "</div>\n";
;
}
output += "\n<!-- Uncomment the line below to see the contents of the `forecast` object. -->\n<!-- <div style=\"word-wrap:break-word\" class=\"xsmall dimmed\">";
output += runtime.suppressValue(env.getFilter("dump").call(context, runtime.contextOrFrameLookup(context, frame, "forecast")), env.opts.autoescape);
output += "</div> -->\n";
if(parentTemplate) {
parentTemplate.rootRenderFunc(env, context, frame, runtime, cb);
} else {
cb(null, output);
}
;
} catch (e) {
  cb(runtime.handleError(e, lineno, colno));
}
}
return {
root: root
};

})();
})();

(function() {(window.nunjucksPrecompiled = window.nunjucksPrecompiled || {})["hourly.njk"] = (function() {
function root(env, context, frame, runtime, cb) {
var lineno = 0;
var colno = 0;
var output = "";
try {
var parentTemplate = null;
if(runtime.contextOrFrameLookup(context, frame, "hourly")) {
output += "\n  ";
var t_1;
t_1 = env.getFilter("calcNumEntries").call(context, runtime.contextOrFrameLookup(context, frame, "hourly"));
frame.set("numSteps", t_1, true);
if(frame.topLevel) {
context.setVariable("numSteps", t_1);
}
if(frame.topLevel) {
context.addExport("numSteps", t_1);
}
output += "\n  ";
var t_2;
t_2 = 0;
frame.set("currentStep", t_2, true);
if(frame.topLevel) {
context.setVariable("currentStep", t_2);
}
if(frame.topLevel) {
context.addExport("currentStep", t_2);
}
output += "\n  <table class=\"";
output += runtime.suppressValue(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"tableClass"), env.opts.autoescape);
output += "\">\n    ";
var t_3;
t_3 = (lineno = 4, colno = 31, runtime.callWrap(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "hourly")),"slice"), "hourly[\"slice\"]", context, [0,runtime.contextOrFrameLookup(context, frame, "numSteps")]));
frame.set("hours", t_3, true);
if(frame.topLevel) {
context.setVariable("hours", t_3);
}
if(frame.topLevel) {
context.addExport("hours", t_3);
}
output += "\n    ";
frame = frame.push();
var t_6 = runtime.contextOrFrameLookup(context, frame, "hours");
if(t_6) {t_6 = runtime.fromIterator(t_6);
var t_5 = t_6.length;
for(var t_4=0; t_4 < t_6.length; t_4++) {
var t_7 = t_6[t_4];
frame.set("hour", t_7);
frame.set("loop.index", t_4 + 1);
frame.set("loop.index0", t_4);
frame.set("loop.revindex", t_5 - t_4);
frame.set("loop.revindex0", t_5 - t_4 - 1);
frame.set("loop.first", t_4 === 0);
frame.set("loop.last", t_4 === t_5 - 1);
frame.set("loop.length", t_5);
output += "\n      <tr\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"colored")) {
output += "class=\"colored\"";
;
}
output += "\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"fade")) {
output += "style=\"opacity: ";
output += runtime.suppressValue(env.getFilter("opacity").call(context, runtime.contextOrFrameLookup(context, frame, "currentStep"),runtime.contextOrFrameLookup(context, frame, "numSteps")), env.opts.autoescape);
output += ";\"";
;
}
output += "\n      >\n        <td class=\"day\">";
output += runtime.suppressValue(env.getFilter("formatTime").call(context, runtime.memberLookup((t_7),"date")), env.opts.autoescape);
output += "</td>\n        <td class=\"bright weather-icon\">\n          <span class=\"wi weathericon wi-";
output += runtime.suppressValue(runtime.memberLookup((t_7),"weatherType"), env.opts.autoescape);
output += "\"></span>\n        </td>\n        <td class=\"align-right bright\">";
output += runtime.suppressValue(env.getFilter("unit").call(context, env.getFilter("roundValue").call(context, runtime.memberLookup((t_7),"temperature")),"temperature"), env.opts.autoescape);
output += "</td>\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showUVIndex")) {
output += "\n          <td class=\"align-right bright uv-index\">\n            ";
if(runtime.memberLookup((t_7),"uvIndex") != 0) {
output += "\n              ";
output += runtime.suppressValue(runtime.memberLookup((t_7),"uvIndex"), env.opts.autoescape);
output += "\n              <span class=\"wi weathericon wi-hot\"></span>\n            ";
;
}
output += "\n          </td>\n        ";
;
}
output += "\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showHumidity") != "none") {
output += "\n          <td class=\"align-left bright humidity-hourly\">\n            ";
output += runtime.suppressValue(runtime.memberLookup((t_7),"humidity"), env.opts.autoescape);
output += "\n            <span class=\"wi wi-humidity humidity-icon\"></span>\n          </td>\n        ";
;
}
output += "\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showPrecipitationAmount")) {
output += "\n          ";
if((!runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"hideZeroes") || runtime.memberLookup((t_7),"precipitationAmount") > 0)) {
output += "\n            <td class=\"align-right bright precipitation-amount\">";
output += runtime.suppressValue(env.getFilter("unit").call(context, runtime.memberLookup((t_7),"precipitationAmount"),"precip",runtime.memberLookup((t_7),"precipitationUnits")), env.opts.autoescape);
output += "</td>\n          ";
;
}
output += "\n        ";
;
}
output += "\n        ";
if(runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"showPrecipitationProbability")) {
output += "\n          ";
if((!runtime.memberLookup((runtime.contextOrFrameLookup(context, frame, "config")),"hideZeroes") || runtime.memberLookup((t_7),"precipitationAmount") > 0)) {
output += "\n            <td class=\"align-right bright precipitation-prob\">";
output += runtime.suppressValue(env.getFilter("unit").call(context, runtime.memberLookup((t_7),"precipitationProbability"),"precip","%"), env.opts.autoescape);
output += "</td>\n          ";
;
}
output += "\n        ";
;
}
output += "\n      </tr>\n      ";
var t_8;
t_8 = runtime.contextOrFrameLookup(context, frame, "currentStep") + 1;
frame.set("currentStep", t_8, true);
if(frame.topLevel) {
context.setVariable("currentStep", t_8);
}
if(frame.topLevel) {
context.addExport("currentStep", t_8);
}
output += "\n    ";
;
}
}
frame = frame.pop();
output += "\n  </table>\n";
;
}
else {
output += "\n  <div class=\"dimmed light small\">";
output += runtime.suppressValue(env.getFilter("translate").call(context, "LOADING"), env.opts.autoescape);
output += "</div>\n";
;
}
output += "\n<!-- Uncomment the line below to see the contents of the `hourly` object. -->\n<!-- <div style=\"word-wrap:break-word\" class=\"xsmall dimmed\">";
output += runtime.suppressValue(env.getFilter("dump").call(context, runtime.contextOrFrameLookup(context, frame, "hourly")), env.opts.autoescape);
output += "</div> -->\n";
if(parentTemplate) {
parentTemplate.rootRenderFunc(env, context, frame, runtime, cb);
} else {
cb(null, output);
}
;
} catch (e) {
  cb(runtime.handleError(e, lineno, colno));
}
}
return {
root: root
};

})();
})();

