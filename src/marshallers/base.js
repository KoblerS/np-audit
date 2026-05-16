'use strict';

class Marshaller {
  constructor(name, title) {
    this.name = name;
    this.title = title;
  }

  check(code) {
    return null;
  }

  async checkPackage(pkg, config) {
    return null;
  }
}

module.exports = { Marshaller };
