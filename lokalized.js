/*
 * Copyright 2017 Product Mog LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";

// TODO: use http://stackoverflow.com/questions/280712/javascript-unicode-regexes for tokenizer?

(function() {
  var Strings = (function() {
    var Strings = function(options) {

    };

    Strings.prototype.get = function(options) {
      var key;

      if(!options)
        throw "Either a string key or an options dictionary are required";

      if(isString(options)) {
        key = options;
        options = {};
      }

      // TODO

      return key;
    };

    return Strings;
  })();

  var lokalized = {
    Strings: Strings
  };

  function isString(o) {
    return typeof o == "string" || (typeof o == "object" && o.constructor === String);
  }

  function isServerSide() {
    return typeof module !== "undefined" && typeof module.exports !== "undefined";
  }

  if (isServerSide())
    module.exports = lokalized;
  else
    window.lokalized = lokalized;
})();