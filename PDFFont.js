/**
 * This dictionary holds decoded fonts data.
 */
var Fonts = new Dict();

/**
 * This simple object keep a trace of the fonts that have already been decoded
 * by storing a map between the name given by the PDF and the name gather from
 * the font (aka the PostScript code of the font itself for Type1 font).
 */
var _Fonts = {};


var Base64Encoder = {
  encode: function(aData) {
    var str = [];
    var count = aData.length;
    for (var i = 0; i < count; i++)
      str.push(aData.getChar());

    return window.btoa(str.join(""));
  }
};

var TrueTypeFont = function(aFontName, aFontFile) {
  if (_Fonts[aFontName])
    return;
  _Fonts[aFontName] = true;

  //log("Loading a TrueType font: " + aFontName);
  var fontData = Base64Encoder.encode(aFontFile);
  Fonts.set(aFontName, fontData);

  // Add the css rule
  var url = "url(data:font/ttf;base64," + fontData + ");";
  document.styleSheets[0].insertRule("@font-face { font-family: '" + aFontName + "'; src: " + url + " }", 0);
};




var Type1Parser = function(aAsciiStream, aBinaryStream) {
  if (IsStream(aAsciiStream)) {
    var lexer = new Lexer(aAsciiStream);
  } else {
    var lexer = {
      __data__: aAsciiStream.slice(),
      getObj: function() {
        return this.__data__.shift();
      }
    }
  }

  // Turn on this flag for additional debugging logs
  var debug = false;

  var dump = function(aData) {
    if (debug)
      log(aData);
  };

  // Hold the fontName as declared inside the /FontName postscript directive
  // XXX This is a hack but at the moment I need it to map the name declared
  // in the PDF and the name in the PS code.
  var fontName = "";

  /*
   * Parse a whole Type1 font stream (from the first segment to the last)
   * assuming the 'eexec' block is binary data and fill up the 'Fonts'
   * dictionary with the font informations.
   */
  var self = this;
  this.parse = function() {
    if (!debug) {
      while (!processNextToken()) {};
      return fontName;
    } else {
      // debug mode is used to debug postcript processing
      setTimeout(function() {
        if (!processNextToken())
          self.parse();
      }, 0);
    }
  };

  /*
   * Decrypt a Sequence of Ciphertext Bytes to Produce the Original Sequence
   * of Plaintext Bytes. The function took a key as a parameter which can be
   * for decrypting the eexec block of for decoding charStrings.
   */
  var kEexecEncryptionKey = 55665;
  var kCharStringsEncryptionKey = 4330;

  function decrypt(aStream, aKey, aDiscardNumber) {
    var start = Date.now();
    var r = aKey, c1 = 52845, c2 = 22719;
    var decryptedString = [];

    var value = "";
    var count = aStream.length;
    for (var i = 0; i < count; i++) {
      value = aStream.getByte();
      decryptedString[i] = String.fromCharCode(value ^ (r >> 8));
      r = ((value + r) * c1 + c2) & ((1 << 16) - 1);
    }
    var end = Date.now();
    dump("Time to decrypt string of length " + count + " is " + (end - start));
    return decryptedString.slice(aDiscardNumber);
  };

  /*
   * CharStrings are encoded following the the CharString Encoding sequence
   * describe in Chapter 6 of the "Adobe Type1 Font Format" specification.
   * The value in a byte indicates a command, a number, or subsequent bytes
   * that are to be interpreted in a special way.
   *
   * CharString Number Encoding:
   *  A CharString byte containing the values from 32 through 255 inclusive
   *  indicate an integer. These values are decoded in four ranges.
   *
   * 1. A CharString byte containing a value, v, between 32 and 246 inclusive,
   * indicate the integer v - 139. Thus, the integer values from -107 through
   * 107 inclusive may be encoded in single byte.
   *
   * 2. A CharString byte containing a value, v, between 247 and 250 inclusive,
   * indicates an integer involving the next byte, w, according to the formula:
   * [(v - 247) x 256] + w + 108
   *
   * 3. A CharString byte containing a value, v, between 251 and 254 inclusive,
   * indicates an integer involving the next byte, w, according to the formula:
   * -[(v - 251) * 256] - w - 108
   *
   * 4. A CharString containing the value 255 indicates that the next 4 bytes
   * are a two complement signed integer. The first of these bytes contains the
   * highest order bits, the second byte contains the next higher order bits
   * and the fourth byte contain the lowest order bits.
   *
   *
   * CharString Command Encoding:
   *  CharStrings commands are encoded in 1 or 2 bytes.
   *
   *  Single byte commands are encoded in 1 byte that contains a value between
   *  0 and 31 inclusive.
   *  If a command byte contains the value 12, then the value in the next byte
   *  indicates a command. This "escape" mechanism allows many extra commands
   * to be encoded and this encoding technique helps to minimize the length of
   * the charStrings.
   */
  var charStringDictionary = {
    "1": "hstem",
    "3": "vstem",
    "4": "vmoveto",
    "5": "rlineto",
    "6": "hlineto",
    "7": "vlineto",
    "8": "rrcurveto",
    "9": "closepath",
    "10": "callsubr",
    "11": "return",
    "12": {
      "0": "dotsection",
      "1": "vstem3",
      "3": "hstem3",
      "6": "seac",
      "7": "sbw",
      "12": "div",
      "16": "callothersubr",
      "17": "pop",
      "33": "setcurrentpoint"
    },
    "13": "hsbw",
    "14": "endchar",
    "21": "rmoveto",
    "22": "hmoveto",
    "30": "vhcurveto",
    "31": "hcurveto"
  };

  function decodeCharString(aStream) {
    var start = Date.now();
    var charString = [];

    var value = "";
    var count = aStream.length;
    for (var i = 0; i < count; i++) {
      value = aStream.getByte();

      if (value < 32) {
        if (value == 12) {
          value = charStringDictionary["12"][aStream.getByte()];
          i++;
        } else {
          value = charStringDictionary[value];
        }
      } else if (value <= 246) {
        value = parseInt(value) - 139;
      } else if (value <= 250) {
        value = ((value - 247) * 256) + parseInt(aStream.getByte()) + 108;
        i++;
      } else if (value <= 254) {
        value = -((value - 251) * 256) - parseInt(aStream.getByte()) - 108;
        i++;
      } else {
        var byte = aStream.getByte();
        var high = (byte >> 1);
        value = (byte - high) << 24 | aStream.getByte() << 16 |
                aStream.getByte() << 8 | aStream.getByte();
        i += 4;
      }

      charString.push(value);
    }

    var end = Date.now();
    dump("Time to decode charString of length " + count + " is " + (end - start));
    return charString;
  }

  /*
   * The operand stack holds arbitrary PostScript objects that are the operands
   * and results of PostScript operators being executed. The interpreter pushes
   * objects on the operand stack when it encounters them as literal data in a
   * program being executed. When an operator requires one or more operands, it
   * obtains them by popping them off the top of the operand stack. When an
   * operator returns one or more results, it does so by pushing them on the
   * operand stack.
   */
   var operandStack = {
    __innerStack__: [],

    push: function(aOperand) {
      this.__innerStack__.push(aOperand);
    },

    pop: function() {
      if (!this.length)
        throw new Error("stackunderflow");
      return this.__innerStack__.pop();
    },

    peek: function() {
      if (!this.length)
        return null;
      return this.__innerStack__[this.__innerStack__.length - 1];
    },

    get: function(aIndex) {
      return this.__innerStack__[aIndex];
    },

    dump: function() {
      log("=== Start Dumping operandStack ===");
      var str = [];
      for (var i = 0; i < this.length; i++)
        log(this.__innerStack__[i]);
      log("=== End Dumping operandStack ===");
    },

    get length() {
      return this.__innerStack__.length;
    }
   };

   // Flag indicating if the topmost operand of the operandStack is an array
   var operandIsArray = 0;

  /*
   * The dictionary stack holds only dictionary objects. The current set of
   * dictionaries on the dictionary stack defines the environment for all
   * implicit name searches, such as those that occur when the interpreter
   * encounters an executable name. The role of the dictionary stack is
   * introduced in Section 3.3, “Data Types and Objects,” and is further
   * explained in Section 3.5, “Execution.” of the PostScript Language
   * Reference.
   */
  var systemDict = new Dict(),
      globalDict = new Dict(),
      userDict   = new Dict();

  var dictionaryStack = {
    __innerStack__: [systemDict, globalDict, userDict],

    push: function(aDictionary) {
      this.__innerStack__.push(aDictionary);
    },

    pop: function() {
      if (this.__innerStack__.length == 3)
        return null;

      return this.__innerStack__.pop();
    },

    peek: function() {
      if (!this.length)
        return null;
      return this.__innerStack__[this.__innerStack__.length - 1];
    },

    get: function(aIndex) {
      return this.__innerStack__[aIndex];
    },

    get length() {
      return this.__innerStack__.length;
    },

    dump: function() {
      log("=== Start Dumping dictionaryStack ===");
      var str = [];
      for (var i = 0; i < this.length; i++)
        log(this.__innerStack__[i]);
      log("=== End Dumping dictionaryStack ===");
    },
  };

  /*
   * The execution stack holds executable objects (mainly procedures and files)
   * that are in intermediate stages of execution. At any point in the
   * execution of a PostScript program, this stack represents the program’s
   * call stack. Whenever the interpreter suspends execution of an object to
   * execute some other object, it pushes the new object on the execution
   * stack. When the interpreter finishes executing an object, it pops that
   * object off the execution stack and resumes executing the suspended object
   * beneath it.
   */
  var executionStack = {
    __innerStack__: [],

    push: function(aProcedure) {
      this.__innerStack__.push(aProcedure);
    },

    pop: function() {
      return this.__innerStack__.pop();
    },

    peek: function() {
      if (!this.length)
        return null;
      return this.__innerStack__[this.__innerStack__.length - 1];
    },

    get: function(aIndex) {
      return this.__innerStack__[aIndex];
    },

    get length() {
      return this.__innerStack__.length;
    }
  };

  /*
   * Return the next token in the execution stack
   */
  function nextInStack() {
    var currentProcedure = executionStack.peek();
    if (currentProcedure) {
      var command = currentProcedure.shift();
      if (!currentProcedure.length)
        executionStack.pop();
      return command;
    }

    return lexer.getObj();
  };

  /*
   * Get the next token from the executionStack and process it.
   * Actually the function does not process the third segment of a Type1 font
   * and end on 'closefile'.
   *
   * The method thrown an error if it encounters an unknown token.
   */
  function processNextToken() {
    var obj = nextInStack();
    if (operandIsArray && !IsCmd(obj, "{") && !IsCmd(obj, "[") &&
                          !IsCmd(obj, "]") && !IsCmd(obj, "}")) {
      dump("Adding an object: " + obj +" to array " + operandIsArray);
      var currentArray = operandStack.peek();
      for (var i = 1; i < operandIsArray; i++)
        currentArray = currentArray[currentArray.length - 1];

      currentArray.push(obj);
    } else if (IsBool(obj) || IsInt(obj) || IsNum(obj) || IsString(obj)) {
      dump("Value: " + obj);
      operandStack.push(obj);
    } else if (IsName(obj)) {
      dump("Name: " + obj.name);
      operandStack.push(obj.name);
    } else if (IsCmd(obj)) {
      var command = obj.cmd;
      dump(command);

      switch (command) {
        case "[":
        case "{":
          dump("Start" + (command == "{" ? " Executable " : " ") + "Array");
          operandIsArray++;
          var currentArray = operandStack;
          for (var i = 1; i < operandIsArray; i++)
            if (currentArray.peek)
              currentArray = currentArray.peek();
            else
              currentArray = currentArray[currentArray.length - 1];
          currentArray.push([]);
          break;

        case "]":
        case "}":
          var currentArray = operandStack.peek();
          for (var i = 1; i < operandIsArray; i++)
            currentArray = currentArray[currentArray.length - 1];
          dump("End" + (command == "}" ? " Executable " : " ") + "Array: " + currentArray.join(" "));
          operandIsArray--;
          break;

        case "if":
          var procedure = operandStack.pop();
          var bool = operandStack.pop();
          if (!IsBool(bool)) {
            dump("if: " + bool);
            // we need to execute things, let be dirty
            executionStack.push(bool);
          } else {
            dump("if ( " + bool + " ) { " + procedure + " }");
            if (bool)
              executionStack.push(procedure);
          }
          break;

        case "ifelse":
          var procedure1 = operandStack.pop();
          var procedure2 = operandStack.pop();
          var bool = !!operandStack.pop();
          dump("if ( " + bool + " ) { " + procedure2 + " } else { " + procedure1 + " }");
          executionStack.push(bool ? procedure2 : procedure1);
          break;

        case "for":
          var procedure = operandStack.pop();
          var limit = operandStack.pop();
          var increment = operandStack.pop();
          var initial = operandStack.pop();
          for (var i = 0; i < limit; i += increment) {
            operandStack.push(i);
            executionStack.push(procedure.slice());
          }
          break;

        case "dup":
          dump("duplicate: " + operandStack.peek());
          operandStack.push(operandStack.peek());
          break;

        case "mark":
          operandStack.push("mark");
          break;

        case "cleartomark":
          var command = "";
          do {
            command = operandStack.pop();
          } while (command != "mark");
          break;

        case "put":
          var data = operandStack.pop();
          var indexOrKey = operandStack.pop();
          var object = operandStack.pop();
          dump("put " + data + " in " + object + "[" + indexOrKey + "]");
          object.set ? object.set(indexOrKey, data)
                     : object[indexOrKey] = data;
          break;

        case "pop":
          operandStack.pop();
          break;

        case "exch":
          var operand1 = operandStack.pop();
          var operand2 = operandStack.pop();
          operandStack.push(operand1);
          operandStack.push(operand2);
          break;

        case "get":
          var indexOrKey = operandStack.pop();
          var object = operandStack.pop();
          var data = object.get ? object.get(indexOrKey) : object[indexOrKey];
          dump("get " + object + "[" + indexOrKey + "]: " + data);
          operandStack.push(data);
          break;

        case "currentdict":
          var dict = dictionaryStack.peek();
          operandStack.push(dict);
          break;

        case "systemdict":
          operandStack.push(systemDict);
          break;

        case "readonly":
        case "executeonly":
        case "noaccess":
          // Do nothing for the moment
          break;

        case "currentfile":
          operandStack.push("currentfile");
          break;

        case "array":
          var size = operandStack.pop();
          var array = new Array(size);
          operandStack.push(array);
          break;

        case "dict":
          var size = operandStack.pop();
          var dict = new Dict(size);
          operandStack.push(dict);
          break;

        case "begin":
          dictionaryStack.push(operandStack.pop());
          break;

        case "end":
          dictionaryStack.pop();
          break;

        case "def":
          var value = operandStack.pop();
          var key = operandStack.pop();

          // XXX we don't want to do that here but for some reasons the names
          // are different between what is declared and the FontName directive
          if (key == "FontName" && Fonts.get(value)) {
            // The font has already be decoded, stop!
            return true;
          }

          dump("def: " + key + " = " + value);
          dictionaryStack.peek().set(key, value);
          break;

        case "definefont":
          var font = operandStack.pop();
          var key = operandStack.pop();
          dump("definefont " + font + " with key: " + key);

          // The key will be the identifier to recognize this font
          fontName = key;
          Fonts.set(key, font);

          operandStack.push(font);
          break;

        case "known":
          var name = operandStack.pop();
          var dict = operandStack.pop();
          var data = !!dict.get(name);
          dump("known: " + data + " :: " + name + " in dict: " + dict);
          operandStack.push(data);
          break;

        case "exec":
          executionStack.push(operandStack.pop());
          break;

        case "eexec":
          // All the first segment data has been read, decrypt the second segment
          // and start interpreting it in order to decode it
          var file = operandStack.pop();
          var eexecString = decrypt(aBinaryStream, kEexecEncryptionKey, 4).join("");
          dump(eexecString);
          lexer = new Lexer(new StringStream(eexecString));
          break;

        case "LenIV":
          error("LenIV: argh! we need to modify the length of discard characters for charStrings");
          break;

        case "closefile":
          var file = operandStack.pop();
          return true;
          break;

        case "index":
          var operands = [];
          var size = operandStack.pop();
          for (var i = 0; i < size; i++)
            operands.push(operandStack.pop());

          var newOperand = operandStack.peek();

          while (operands.length)
            operandStack.push(operands.pop());

          operandStack.push(newOperand);
          break;

        case "string":
          var size = operandStack.pop();
          var str = (new Array(size + 1)).join(" ");
          operandStack.push(str);
          break;

        case "readstring":
          var str = operandStack.pop();
          var size = str.length;

          var file = operandStack.pop();

          // Add '1' because of the space separator, this is dirty
          var stream = lexer.stream.makeSubStream(lexer.stream.pos + 1, size);
          lexer.stream.skip(size + 1);

          var charString = decrypt(stream, kCharStringsEncryptionKey, 4).join("");
          var charStream = new StringStream(charString);
          var decodedCharString = decodeCharString(charStream);
          dump("decodedCharString: " + decodedCharString);
          operandStack.push(decodedCharString);

          // boolean indicating if the operation is a success or not
          operandStack.push(true);
          break;

        case "StandardEncoding":
          // For some reason the value is considered as a command, maybe it is
          // because of the uppercase 'S'
          operandStack.push(obj.cmd);
          break;

        default:
          var command = null;
          if (IsCmd(obj)) {
            for (var i = 0; i < dictionaryStack.length; i++) {
              if (command = dictionaryStack.get(i).get(obj.cmd)) {
                dump("found in dictionnary for " + obj.cmd + " command: " + command);
                executionStack.push(command.slice());
                break;
              }
            }
          }

          if (!command) {
            log("operandStack: " + operandStack);
            log("dictionaryStack: " + dictionaryStack);
            log(obj);
            error("Unknow command while parsing font");
          }
          break;
      }
    } else if (obj) {
      dump("unknow: " + obj);
      operandStack.push(obj);
    } else { // The End!
      operandStack.dump();
      return true;
    }

    return false;
  }

  function aggregateCommand(aCommand) {
    var command = aCommand;
    switch (command) {
      case "hstem":
      case "vstem":
        break;

      case "rrcurveto":
        var stack = [operandStack.pop(), operandStack.pop(),
                     operandStack.pop(), operandStack.pop(),
                     operandStack.pop(), operandStack.pop()];
        var next = true;
        while (next) {
          var op = operandStack.peek();
          if (op == "rrcurveto") {
            operandStack.pop();
            stack.push(operandStack.pop());
            stack.push(operandStack.pop());
            stack.push(operandStack.pop());
            stack.push(operandStack.pop());
            stack.push(operandStack.pop());
            stack.push(operandStack.pop());
          } else {
            next = false;
          }
        }
        break;

      case "hlineto":
      case "vlineto":
        var last = command;
        var stack = [operandStack.pop()];
        var next = true;
        while (next) {
          var op = operandStack.peek();
          if (op == "vlineto" && last == "hlineto") {
            operandStack.pop();
            stack.push(operandStack.pop());
          } else if (op == "hlineto" && last == "vlineto") {
            operandStack.pop();
            stack.push(operandStack.pop());
          } else if (op == "rlineto" && command == "hlineto") {
            operandStack.pop();
            var x = stack.pop();
            operandStack.push(0);
            operandStack.push(x);
            command = "rlineto";
          } else if (op == "rlineto" && command == "vlineto") {
            operandStack.pop();
            operandStack.push(0);
            command = "rlineto";
          } else {
            next = false;
          }
          last = op;
        }
        break;

      case "rlineto":
        var stack = [operandStack.pop(), operandStack.pop()];
        var next = true;
        while (next) {
          var op = operandStack.peek();
          if (op == "rlineto") {
            operandStack.pop();
            stack.push(operandStack.pop());
            stack.push(operandStack.pop());
          } else if (op == "hlineto") {
            operandStack.pop();
            stack.push(0);
            stack.push(operandStack.pop());
          } else if (op == "vlineto") {
            operandStack.pop();
            stack.push(operandStack.pop());
            stack.push(0);
          } else {
            next= false;
          }
        }
        break;
    }

    while (stack.length)
      operandStack.push(stack.pop());
    operandStack.push(command);
  };


  /*
   * Flatten the commands by interpreting the postscript code and replacing
   * every 'callsubr', 'callothersubr' by the real commands.
   * At the moment OtherSubrs are not fully supported and only otherSubrs 0-4
   * as descrived in 'Using Subroutines' of 'Adobe Type 1 Font Format',
   * chapter 8.
   */
  this.flattenCharstring = function(aCharString, aDefaultWidth, aNominalWidth, aSubrs) {
    var leftSidebearing = 0;
    var lastPoint = 0;
    while (true) {
      var obj = nextInStack();
      if (IsBool(obj) || IsInt(obj) || IsNum(obj)) {
        dump("Value: " + obj);
        operandStack.push(obj);
      } else if (IsString(obj)) {
        dump("String: " + obj);
        switch (obj) {
          case "hsbw":
            var charWidthVector = operandStack.pop();
            leftSidebearing = operandStack.pop();

            if (charWidthVector != aDefaultWidth)
              operandStack.push(charWidthVector - aNominalWidth);
            break;

          case "setcurrentpoint":
          case "dotsection":
          case "seac":
          case "sbw":
            error(obj + " parsing is not implemented (yet)");
            break;

          case "vstem3":
            operandStack.push("vstem");
            break;

          case "vstem":
            log(obj + " is not converted (yet?)");
            operandStack.push("vstem");
            break;

          case "closepath":
          case "return":
            break;

          case "hlineto":
          case "vlineto":
          case "rlineto":
          case "rrcurveto":
            aggregateCommand(obj);
            break;

          case "rmoveto":
            var dy = operandStack.pop();
            var dx = operandStack.pop();

            if (leftSidebearing) {
              dx += leftSidebearing;
              leftSidebearing = 0;
            }

            operandStack.push(dx);
            operandStack.push(dy);
            operandStack.push("rmoveto");
            break;

          case "hstem":
          case "hstem3":
            var dy = operandStack.pop();
            var y = operandStack.pop();
            if (operandStack.peek() == "hstem" ||
                operandStack.peek() == "hstem3")
              operandStack.pop();

            operandStack.push(y - lastPoint);
            lastPoint = y + dy;

            operandStack.push(dy);
            operandStack.push("hstem");
            break;

          case "callsubr":
            var index = operandStack.pop();
            executionStack.push(aSubrs[index].slice());
            break;

          case "callothersubr":
            log("callothersubr");
            // XXX need to be improved
            var index = operandStack.pop();
            var count = operandStack.pop();
            var data = operandStack.pop();
            operandStack.push(3);
            operandStack.push("callothersubr");
            break;
          case "endchar":
            operandStack.push("endchar");
            return operandStack.__innerStack__.slice();
          case "pop":
            operandStack.pop();
            break;
          default:
            operandStack.push(obj);
            break;
        }
      }
    }
  }
};


var type1hack = false;
var Type1Font = function(aFontName, aFontFile) {
  if (_Fonts[aFontName])
    return;
  _Fonts[aFontName] = true;

  // All Type1 font program should begin with the comment %!
  if (aFontFile.getByte() != 0x25 || aFontFile.getByte() != 0x21)
    error("Invalid file header");

  if (!type1hack) {
    type1hack = true;
    var start = Date.now();

    var ASCIIStream = aFontFile.makeSubStream(0, aFontFile.dict.get("Length1"), aFontFile.dict);
    var binaryStream = aFontFile.makeSubStream(aFontFile.dict.get("Length1"), aFontFile.dict.get("Length2"), aFontFile.dict);

    this.parser = new Type1Parser(ASCIIStream, binaryStream);
    var fontName = this.parser.parse();
    this.convertToOTF(fontName);
  }
};

Type1Font.prototype = {
  convertToOTF: function(aFontName) {
    var font = Fonts.get(aFontName);

    var private = font.get("Private");
    var subrs = private.get("Subrs");
    var otherSubrs = private.get("OtherSubrs");
    var charstrings = font.get("CharStrings")

    // Try to get the most used glyph width
    var widths = {};
    for (var glyph in charstrings.map) {
      var glyphData = charstrings.get(glyph);
      var glyphWidth = glyphData[1];
      if (widths[glyphWidth])
        widths[glyphWidth]++;
      else
        widths[glyphWidth] = 1;
    }

    var defaultWidth = 0;
    var used = 0;
    for (var width in widths) {
      if (widths[width] > used) {
        defaultWidth = width;
        used = widths[width];
      }
    }
    log("defaultWidth to used: " + defaultWidth);

    var maxNegDistance = 0;
    var maxPosDistance = 0;
    for (var width in widths) {
      var diff = width - defaultWidth;
      if (diff < 0 && diff < maxNegDistance) {
        maxNegDistance = diff;
      } else if (diff > 0 && diff > maxPosDistance) {
        maxPosDistance = diff;
      }
    }

    var nominalWidth = parseInt(defaultWidth) + (parseInt(maxPosDistance) + parseInt(maxNegDistance)) / 2;
    log("nominalWidth to used: " + nominalWidth);
    log("Hack nonimal:" + (nominalWidth = 615));

    for (var glyph in charstrings.map) {
      if (glyph == ".notdef")
        continue;

      var glyphData = charstrings.get(glyph);
      var parser = new Type1Parser(glyphData);
      log("=================================== " + glyph + " ==============================");
      log(charstrings.get(glyph));
      log(parser.flattenCharstring("A", defaultWidth, nominalWidth, subrs));
      log(validationData[glyph]);
    }


    /*
    log(charStrings.get("A"));
    log(newCharStrings.get("A"));
    log(validationData["A"]);
    */
    var end = Date.now();
    //log("Time to parse font is:" + (end - start));
  }
};













/**
 * The Type2 reader code below is only used for debugging purpose since Type2
 * is only a CharString format and is never used directly as a Font file.
 *
 * So the code here is useful for dumping the data content of a .cff file in
 * order to investigate the similarity between a Type1 CharString and a Type2
 * CharString.
 */


/**
 * Build a charset by assigning the glyph name and the human readable form
 * of the glyph data.
 */
function readCharset(aStream, aCharstrings) {
  var charset = {};

  var format = aStream.getByte();
  if (format == 0) {
    charset[".notdef"] = readCharstringEncoding(aCharstrings[0]);

    var count = aCharstrings.length - 1;
    for (var i = 1; i < count + 1; i++) {
      var sid = aStream.getByte() << 8 | aStream.getByte();
      charset[CFFStrings[sid]] = readCharstringEncoding(aCharstrings[i]);
      log(CFFStrings[sid] + "::" + charset[CFFStrings[sid]]);
    }
  } else if (format == 1) {
    error("Charset Range are not supported");
  } else {
    error("Invalid charset format");
  }

  return charset;
};

/**
 * Take a Type2 binary charstring as input and transform it to a human
 * readable representation as specified by the 'The Type 2 Charstring Format',
 * chapter 3.1.
 */
function readCharstringEncoding(aString) {
  var charstringTokens = [];

  var count = aString.length;
  for (var i = 0; i < count; ) {
    var value = aString[i++];
    var token = null;

    if (value < 0) {
      continue;
    } else if (value <= 11) {
      token = CFFEncodingMap[value];
    } else if (value == 12) {
      token = CFFEncodingMap[value][aString[i++]];
    } else if (value <= 18) {
      token = CFFEncodingMap[value];
    } else if (value <= 20) {
      var mask = aString[i++];
      token = CFFEncodingMap[value];
    } else if (value <= 27) {
      token = CFFEncodingMap[value];
    } else if (value == 28) {
      token = aString[i++] << 8 | aString[i++];
    } else if (value <= 31) {
      token = CFFEncodingMap[value];
    } else if (value < 247) {
      token = parseInt(value) - 139;
    } else if (value < 251) {
      token = ((value - 247) * 256) + aString[i++] + 108;
    } else if (value < 255) {
      token = -((value - 251) * 256) - aString[i++] - 108;
    } else {// value == 255
      token = aString[i++] << 24 | aString[i++] << 16 |
              aString[i++] << 8 | aString[i];
    }

    charstringTokens.push(token);
  }

  return charstringTokens;
};


/**
 * Take a binary DICT Data as input and transform it into a human readable
 * form as specified by 'The Compact Font Format Specification', chapter 5.
 */
function readFontDictData(aString, aMap) {
  var fontDictDataTokens = [];

  var count = aString.length;
  for (var i = 0; i < count; i) {
    var value = aString[i++];
    var token = null;

    if (value == 12) {
      token = aMap[value][aString[i++]];
    } else if (value == 28) {
      token = aString[i++] << 8 | aString[i++];
    } else if (value == 29) {
      token = aString[i++] << 24 |
              aString[i++] << 16 |
              aString[i++] << 8  |
              aString[i++];
    } else if (value == 30) {
      token = "";
      var parsed = false;
      while (!parsed) {
        var byte = aString[i++];

        var nibbles = [parseInt(byte / 16), parseInt(byte % 16)];
        for (var j = 0; j < nibbles.length; j++) {
          var nibble = nibbles[j];
          switch (nibble) {
            case 0xA:
              token += ".";
              break;
            case 0xB:
              token += "E";
              break;
            case 0xC:
              token += "E-";
              break;
            case 0xD:
              break;
            case 0xE:
              token += "-";
              break;
            case 0xF:
              parsed = true;
              break;
            default:
              token += nibble;
              break;
          }
        }
      };
      token = parseFloat(token);
    } else if (value <= 31) {
      token = aMap[value];
    } else if (value <= 246) {
      token = parseInt(value) - 139;
    } else if (value <= 250) {
      token = ((value - 247) * 256) + aString[i++] + 108;
    } else if (value <= 254) {
      token = -((value - 251) * 256) - aString[i++] - 108;
    } else if (value == 255) {
      error("255 is not a valid DICT command");
    }

    fontDictDataTokens.push(token);
  }

  return fontDictDataTokens;
};


/**
 * Take a stream as input and return an array of objects.
 * In CFF an INDEX is a structure with the following format:
 *  {
 *    count: 2 bytes (Number of objects stored in INDEX),
 *    offsize: 1 byte (Offset array element size),
 *    offset: [count + 1] bytes (Offsets array),
 *    data: - (Objects data)
 *  }
 *
 *  More explanation are given in the 'CFF Font Format Specification',
 *  chapter 5.
 */
function readFontIndexData(aStream, aIsByte) {
  var count = aStream.getByte() << 8 | aStream.getByte();
  var offsize = aStream.getByte();

  function getNextOffset() {
    switch (offsize) {
      case 0:
        return 0;
      case 1:
        return aStream.getByte();
      case 2:
        return aStream.getByte() << 8 | aStream.getByte();
      case 3:
        return aStream.getByte() << 16 | aStream.getByte() << 8 |
               aStream.getByte();
      case 4:
      return aStream.getByte() << 24 | aStream.getByte() << 16 |
             aStream.getByte() << 8 | aStream.getByte();
    }
  };

  var offsets = [];
  for (var i = 0; i < count + 1; i++)
    offsets.push(getNextOffset());

  log("Found " + count + " objects at offsets :" + offsets + " (offsize: " + offsize + ")");

  // Now extract the objects
  var relativeOffset = aStream.pos;
  var objects = [];
  for (var i = 0; i < count; i++) {
    var offset = offsets[i];
    aStream.pos = relativeOffset + offset - 1;

    var data = [];
    var length = offsets[i + 1] - 1;
    for (var j = offset - 1; j < length; j++)
      data.push(aIsByte ? aStream.getByte() : aStream.getChar());
    objects.push(data);
  }

  return objects;
};

var Type2Parser = function(aFilePath) {
  var font = new Dict();

  // Turn on this flag for additional debugging logs
  var debug = true;

  function dump(aStr) {
    if (debug)
      log(aStr);
  };

  function parseAsToken(aString, aMap) {
    var decoded = readFontDictData(aString, aMap);
    log(decoded);

    var stack = [];
    var count = decoded.length;
    for (var i = 0; i < count; i++) {
      var token = decoded[i];
      if (IsNum(token)) {
        stack.push(token);
      } else {
        switch (token.operand) {
          case "SID":
            font.set(token.name, CFFStrings[stack.pop()]);
            break;
          case "number number":
            font.set(token.name, {
              offset: stack.pop(),
              size: stack.pop()
            });
            break;
          case "boolean":
            font.set(token.name, stack.pop());
            break;
          case "delta":
            font.set(token.name, stack.pop());
            break;
          default:
            if (token.operand && token.operand.length) {
              var array = [];
              for (var j = 0; j < token.operand.length; j++)
                array.push(stack.pop());
              font.set(token.name, array);
            } else {
              font.set(token.name, stack.pop());
            }
            break;
        }
      }
    }
  };

  this.parse = function(aStream) {
    font.set("major", aStream.getByte());
    font.set("minor", aStream.getByte());
    font.set("hdrSize", aStream.getByte());
    font.set("offsize", aStream.getByte());

    // Move the cursor after the header
    aStream.skip(font.get("hdrSize") - aStream.pos);

    // Read the NAME Index
    dump("Reading Index: Names");
    font.set("Names", readFontIndexData(aStream));

    // Read the Top Dict Index
    dump("Reading Index: TopDict");
    var topDict = readFontIndexData(aStream, true);

    // Read the String Index
    dump("Reading Index: Strings");
    var strings = readFontIndexData(aStream);

    // Fill up the Strings dictionary with the new unique strings
    for (var i = 0; i < strings.length; i++)
      CFFStrings.push(strings[i].join(""));

    // Parse the TopDict operator
    var objects = [];
    var count = topDict.length;
    for (var i = 0; i < count; i++)
      parseAsToken(topDict[i], CFFDictDataMap);

    // Read the Global Subr Index that comes just after the Strings Index
    // (cf. "The Compact Font Format Specification" Chapter 16)
    dump("Reading Global Subr Index");
    var subrs = readFontIndexData(aStream);

    // Reading Private Dict
    var private = font.get("Private");
    log("Reading Private Dict (offset: " + private.offset + " size: " + private.size + ")");
    aStream.pos = private.offset;

    var privateDict = [];
    for (var i = 0; i < private.size; i++)
      privateDict.push(aStream.getByte());
    parseAsToken(privateDict, CFFDictPrivateDataMap);

    for (var p in font.map)
      dump(p + "::" + font.get(p));

    // Read CharStrings Index
    var charStringsOffset = font.get("CharStrings");
    dump("Read CharStrings Index (offset: " + charStringsOffset + ")");
    aStream.pos = charStringsOffset;
    var charStrings = readFontIndexData(aStream, true);


    var charsetEntry = font.get("charset");
    if (charsetEntry == 0) {
      throw new Error("Need to support CFFISOAdobeCharset");
    } else if (charsetEntry == 1) {
      throw new Error("Need to support CFFExpert");
    } else if (charsetEntry == 2) {
      throw new Error("Need to support CFFExpertSubsetCharset");
    } else {
      aStream.pos = charsetEntry;
      var charset = readCharset(aStream, charStrings);
    }

  }
};


// XXX
/*
var xhr = new XMLHttpRequest();
xhr.open("GET", "titi.cff", false);
xhr.mozResponseType = xhr.responseType = "arraybuffer";
xhr.expected = (document.URL.indexOf("file:") == 0) ? 0 : 200;
xhr.send(null);
var cffData = xhr.mozResponseArrayBuffer || xhr.mozResponse ||
              xhr.responseArrayBuffer || xhr.response;
var cff = new Type2Parser("titi.cff");
cff.parse(new Stream(cffData));
*/
