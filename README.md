## Lokalized

Lokalized facilitates natural-sounding software translations.

See https://github.com/lokalized/lokalized-java/tree/develop for current Java library documentation.

For now, here's a flavor of the JavaScript port:

```js
var strings = new localized.Strings("en");

var translated = strings.get("I read {{bookCount}} books", {
  bookCount: 0
});

// Prints "I haven't read any books"
console.log(translated);

// Try again with a different value
translated = strings.get("I read {{bookCount}} books", {
  bookCount: 1
});

// Prints "I read 1 book"
console.log(translated);
```