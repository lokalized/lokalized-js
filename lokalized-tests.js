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

var lokalized = require("./lokalized.js");

function assert(expected, actual) {
  if (expected !== actual)
    throw new Error("Assertion failed.\nExpected: " + expected + "\nActual: " + actual);
}

function basicTest() {
  var strings = new lokalized.Strings("en");
  assert("Hello, world!", strings.get("Hello, world!"));
}

function placeholderTest() {
  var strings = new lokalized.Strings("en");

  var translated = strings.get("I read {{bookCount}} books", {
    bookCount: 0
  });

  assert("I didn't read any books", translated);
}

basicTest();
placeholderTest();