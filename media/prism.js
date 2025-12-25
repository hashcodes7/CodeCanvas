/* PrismJS 1.29.0 avec TypeScript */
var Prism = (function (_self) {
    var langPattern = /\blang(?:uage)?-([\w-]+)\b/i;
    var uniqueId = 0;

    var prism = {
        manual: _self.Prism && _self.Prism.manual,
        disableWorkerMessageHandler: _self.Prism && _self.Prism.disableWorkerMessageHandler,
        util: {
            encode: function encode(tokens) {
                if (tokens instanceof Token) {
                    return new Token(tokens.type, encode(tokens.content), tokens.alias);
                } else if (Array.isArray(tokens)) {
                    return tokens.map(encode);
                } else {
                    return tokens.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\u00a0/g, ' ');
                }
            },
            type: function (obj) {
                return Object.prototype.toString.call(obj).slice(8, -1);
            },
            objId: function (obj) {
                if (!obj.__id) {
                    Object.defineProperty(obj, '__id', { value: ++uniqueId });
                }
                return obj.__id;
            },
            clone: function clone(o, visited) {
                visited = visited || {};
                var type = prism.util.type(o);
                switch (type) {
                    case 'Object':
                        if (visited[prism.util.objId(o)]) return visited[prism.util.objId(o)];
                        var cloneObj = {};
                        visited[prism.util.objId(o)] = cloneObj;
                        for (var key in o) {
                            if (o.hasOwnProperty(key)) cloneObj[key] = clone(o[key], visited);
                        }
                        return cloneObj;
                    case 'Array':
                        if (visited[prism.util.objId(o)]) return visited[prism.util.objId(o)];
                        var cloneArr = [];
                        visited[prism.util.objId(o)] = cloneArr;
                        o.forEach(function (v, i) { cloneArr[i] = clone(v, visited); });
                        return cloneArr;
                    default:
                        return o;
                }
            },
            getLanguage: function (element) {
                while (element) {
                    var m = langPattern.exec(element.className);
                    if (m) return m[1].toLowerCase();
                    element = element.parentElement;
                }
                return 'none';
            },
            setLanguage: function (element, language) {
                element.className = element.className.replace(RegExp(langPattern, 'gi'), '');
                element.classList.add('language-' + language);
            },
            currentScript: function () {
                if (typeof document === 'undefined') return null;
                if ('currentScript' in document) return document.currentScript;
                try { throw new Error(); } catch (e) {
                    var src = (/at [^(\r\n]*\((.*):[^:]+:[^:]+\)$/i.exec(e.stack) || [])[1];
                    if (src) {
                        var scripts = document.getElementsByTagName('script');
                        for (var i in scripts) if (scripts[i].src == src) return scripts[i];
                    }
                    return null;
                }
            },
            isActive: function (element, language, defaultActivation) {
                var no = 'no-' + language;
                while (element) {
                    var classList = element.classList;
                    if (classList.contains(language)) return true;
                    if (classList.contains(no)) return false;
                    element = element.parentElement;
                }
                return !!defaultActivation;
            }
        },
        languages: {
            plain: {}, plaintext: {}, text: {}, txt: {},
            extend: function (id, redef) {
                var lang = prism.util.clone(prism.languages[id]);
                for (var key in redef) lang[key] = redef[key];
                return lang;
            },
            insertBefore: function (inside, before, insert, root) {
                root = root || prism.languages;
                var grammar = root[inside];
                var ret = {};
                for (var token in grammar) {
                    if (grammar.hasOwnProperty(token)) {
                        if (token == before) {
                            for (var newToken in insert) {
                                if (insert.hasOwnProperty(newToken)) ret[newToken] = insert[newToken];
                            }
                        }
                        if (!insert.hasOwnProperty(token)) ret[token] = grammar[token];
                    }
                }
                var old = root[inside];
                root[inside] = ret;
                prism.languages.DFS(prism.languages, function (key, value) {
                    if (value === old && key != inside) this[key] = ret;
                });
                return ret;
            },
            DFS: function DFS(o, callback, type, visited) {
                visited = visited || {};
                var objId = prism.util.objId;
                for (var i in o) {
                    if (o.hasOwnProperty(i)) {
                        callback.call(o, i, o[i], type || i);
                        var property = o[i];
                        var propertyType = prism.util.type(property);
                        if (propertyType === 'Object' && !visited[objId(property)]) {
                            visited[objId(property)] = true;
                            DFS(property, callback, null, visited);
                        } else if (propertyType === 'Array' && !visited[objId(property)]) {
                            visited[objId(property)] = true;
                            DFS(property, callback, i, visited);
                        }
                    }
                }
            }
        },
        plugins: {},
        highlightAll: function (async, callback) {
            prism.highlightAllUnder(document, async, callback);
        },
        highlightAllUnder: function (container, async, callback) {
            var env = {
                callback: callback,
                container: container,
                selector: 'code[class*="language-"], [class*="language-"] code, code[class*="lang-"], [class*="lang-"] code'
            };
            prism.hooks.run('before-highlightall', env);
            env.elements = Array.prototype.slice.apply(env.container.querySelectorAll(env.selector));
            prism.hooks.run('before-all-elements-highlight', env);
            for (var i = 0, element; element = env.elements[i++];) {
                prism.highlightElement(element, async === true, env.callback);
            }
        },
        highlightElement: function (element, async, callback) {
            var language = prism.util.getLanguage(element);
            var grammar = prism.languages[language];
            prism.util.setLanguage(element, language);
            var parent = element.parentElement;
            if (parent && parent.nodeName.toLowerCase() === 'pre') prism.util.setLanguage(parent, language);
            var code = element.textContent;
            var env = { element: element, language: language, grammar: grammar, code: code };
            function insertHighlightedCode(highlightedCode) {
                env.highlightedCode = highlightedCode;
                prism.hooks.run('before-insert', env);
                env.element.innerHTML = env.highlightedCode;
                prism.hooks.run('after-highlight', env);
                prism.hooks.run('complete', env);
                callback && callback.call(env.element);
            }
            prism.hooks.run('before-sanity-check', env);
            parent = env.element.parentElement;
            if (parent && parent.nodeName.toLowerCase() === 'pre' && !parent.hasAttribute('tabindex')) {
                parent.setAttribute('tabindex', '0');
            }
            if (!env.code) {
                prism.hooks.run('complete', env);
                callback && callback.call(env.element);
                return;
            }
            prism.hooks.run('before-highlight', env);
            if (!env.grammar) {
                insertHighlightedCode(prism.util.encode(env.code));
                return;
            }
            if (async && _self.Worker) {
                var worker = new Worker(prism.filename);
                worker.onmessage = function (ev) { insertHighlightedCode(ev.data); };
                worker.postMessage(JSON.stringify({ language: env.language, code: env.code, immediateClose: true }));
            } else {
                insertHighlightedCode(prism.highlight(env.code, env.grammar, env.language));
            }
        },
        highlight: function (code, grammar, language) {
            var env = { code: code, grammar: grammar, language: language };
            prism.hooks.run('before-tokenize', env);
            env.tokens = prism.tokenize(env.code, env.grammar);
            prism.hooks.run('after-tokenize', env);
            return Token.stringify(prism.util.encode(env.tokens), env.language);
        },
        tokenize: function (text, grammar) {
            var rest = grammar.rest;
            if (rest) {
                for (var token in rest) grammar[token] = rest[token];
                delete grammar.rest;
            }
            var tokenList = new LinkedList();
            addAfter(tokenList, tokenList.head, text);
            tokenizeBySymbol(text, tokenList, grammar, tokenList.head, 0);
            return (function (list) {
                var array = [], node = list.head.next;
                while (node !== list.tail) { array.push(node.value); node = node.next; }
                return array;
            })(tokenList);
        },
        hooks: {
            all: {},
            add: function (name, callback) {
                var hooks = prism.hooks.all;
                hooks[name] = hooks[name] || [];
                hooks[name].push(callback);
            },
            run: function (name, env) {
                var callbacks = prism.hooks.all[name];
                if (callbacks && callbacks.length) {
                    for (var i = 0, callback; callback = callbacks[i++];) callback(env);
                }
            }
        },
        Token: Token
    };

    function Token(type, content, alias, matchedStr) {
        this.type = type;
        this.content = content;
        this.alias = alias;
        this.length = (matchedStr || '').length;
    }
    Token.stringify = function stringify(o, language) {
        if (typeof o === 'string') return o;
        if (Array.isArray(o)) {
            var s = '';
            o.forEach(function (e) { s += stringify(e, language); });
            return s;
        }
        var env = {
            type: o.type, content: stringify(o.content, language), tag: 'span',
            classes: ['token', o.type], attributes: {}, language: language
        };
        var alias = o.alias;
        if (alias) {
            if (Array.isArray(alias)) Array.prototype.push.apply(env.classes, alias);
            else env.classes.push(alias);
        }
        prism.hooks.run('wrap', env);
        var attributes = '';
        for (var name in env.attributes) {
            attributes += ' ' + name + '="' + (env.attributes[name] || '').replace(/"/g, '&quot;') + '"';
        }
        return '<' + env.tag + ' class="' + env.classes.join(' ') + '"' + attributes + '>' + env.content + '</' + env.tag + '>';
    };

    function matchGrammar(text, tokenList, grammar, startNode, startPos, rematch) {
        for (var token in grammar) {
            if (!grammar.hasOwnProperty(token) || !grammar[token]) continue;
            var patterns = grammar[token];
            patterns = Array.isArray(patterns) ? patterns : [patterns];
            for (var j = 0; j < patterns.length; ++j) {
                if (rematch && rematch.cause == token + ',' + j) return;
                var patternObj = patterns[j], inside = patternObj.inside,
                    lookbehind = !!patternObj.lookbehind, greedy = !!patternObj.greedy,
                    alias = patternObj.alias;
                if (greedy && !patternObj.pattern.global) {
                    var flags = patternObj.pattern.toString().match(/[imsuy]*$/)[0];
                    patternObj.pattern = RegExp(patternObj.pattern.source, flags + 'g');
                }
                var pattern = patternObj.pattern || patternObj;
                for (var currentNode = startNode.next, pos = startPos; currentNode !== tokenList.tail; pos += currentNode.value.length, currentNode = currentNode.next) {
                    if (rematch && pos >= rematch.reach) break;
                    var str = currentNode.value;
                    if (tokenList.length > text.length) return;
                    if (str instanceof Token) continue;
                    var index, matchedByteCount = 1;
                    if (greedy) {
                        index = match(pattern, pos, text, lookbehind);
                        if (!index || index.index >= text.length) break;
                        var from = index.index, to = index.index + index[0].length, p = pos;
                        for (p += currentNode.value.length; from >= p;) {
                            currentNode = currentNode.next;
                            p += currentNode.value.length;
                        }
                        p -= currentNode.value.length;
                        pos = p;
                        if (currentNode.value instanceof Token) continue;
                        for (var k = currentNode; k !== tokenList.tail && (p < to || typeof k.value === 'string'); k = k.next) {
                            matchedByteCount++;
                            p += k.value.length;
                        }
                        matchedByteCount--;
                        str = text.slice(pos, p);
                        index.index -= pos;
                    } else {
                        index = match(pattern, 0, str, lookbehind);
                        if (!index) continue;
                    }
                    var from = index.index, matchStr = index[0],
                        before = str.slice(0, from), after = str.slice(from + matchStr.length),
                        reach = pos + str.length;
                    if (rematch && reach > rematch.reach) rematch.reach = reach;
                    var removeFrom = currentNode.prev;
                    if (before) { removeFrom = addAfter(tokenList, removeFrom, before); pos += before.length; }
                    removeRange(tokenList, removeFrom, matchedByteCount);
                    var wrapped = new Token(token, inside ? prism.tokenize(matchStr, inside) : matchStr, alias, matchStr);
                    currentNode = addAfter(tokenList, removeFrom, wrapped);
                    if (after) addAfter(tokenList, currentNode, after);
                    if (matchedByteCount > 1) {
                        var nestedRematch = { cause: token + ',' + j, reach: reach };
                        matchGrammar(text, tokenList, grammar, currentNode.prev, pos, nestedRematch);
                        if (rematch && nestedRematch.reach > rematch.reach) rematch.reach = nestedRematch.reach;
                    }
                }
            }
        }
    }

    function match(pattern, pos, text, lookbehind) {
        pattern.lastIndex = pos;
        var m = pattern.exec(text);
        if (m && lookbehind && m[1]) {
            var lookbehindLength = m[1].length;
            m.index += lookbehindLength;
            m[0] = m[0].slice(lookbehindLength);
        }
        return m;
    }

    function LinkedList() {
        var head = { value: null, prev: null, next: null };
        var tail = { value: null, prev: head, next: null };
        head.next = tail;
        this.head = head; this.tail = tail; this.length = 0;
    }

    function addAfter(list, node, value) {
        var next = node.next;
        var newNode = { value: value, prev: node, next: next };
        node.next = newNode; next.prev = newNode;
        list.length++;
        return newNode;
    }

    function removeRange(list, node, count) {
        var next = node.next;
        for (var i = 0; i < count && next !== list.tail; i++) next = next.next;
        node.next = next; next.prev = node;
        list.length -= i;
    }

    function tokenizeBySymbol(text, tokenList, grammar, startNode, startPos) {
        matchGrammar(text, tokenList, grammar, startNode, startPos);
    }

    return prism;
})(typeof window !== 'undefined' ? window : {});

if (typeof module !== 'undefined' && module.exports) module.exports = Prism;
if (typeof global !== 'undefined') global.Prism = Prism;

Prism.languages.clike = {
    comment: [
        { pattern: /(^|[^\\])\/\*[\s\S]*?(?:\*\/|$)/, lookbehind: true, greedy: true },
        { pattern: /(^|[^\\:])\/\/.*/, lookbehind: true, greedy: true }
    ],
    string: { pattern: /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/, greedy: true },
    keyword: /\b(?:break|catch|continue|do|else|finally|for|function|if|in|instanceof|new|null|return|throw|try|while)\b/,
    boolean: /\b(?:false|true)\b/,
    function: /\b\w+(?=\()/,
    number: /\b0x[\da-f]+\b|(?:\b\d+(?:\.\d*)?|\B\.\d+)(?:e[+-]?\d+)?/i,
    operator: /[<>]=?|[!=]=?=?|--?|\+\+?|&&?|\|\|?|[?*/~^%]/,
    punctuation: /[{}[\];(),.:]/
};

Prism.languages.javascript = Prism.languages.extend('clike', {
    'class-name': [
        Prism.languages.clike['class-name'],
        { pattern: /(^|[^$\w\xA0-\uFFFF])(?!\s)[_$A-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\.(?:constructor|prototype))/, lookbehind: true }
    ],
    keyword: [
        { pattern: /((?:^|\})\s*)catch\b/, lookbehind: true },
        { pattern: /(^|[^.]|\.\.\.\s*)\b(?:as|assert(?=\s*\{)|async(?=\s*(?:function\b|\(|[$\w\xA0-\uFFFF]|$))|await|break|case|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally(?=\s*(?:\{|$))|for|from(?=\s*(?:['"]|$))|function|(?:get|set)(?=\s*(?:[#\[$\w\xA0-\uFFFF]|$))|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)\b/, lookbehind: true }
    ],
    function: /#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?=\s*(?:\.\s*(?:apply|bind|call)\s*)?\()/,
    operator: /--|\+\+|\*\*=?|=>|&&=?|\|\|=?|[!=]==|<<=?|>>>?=?|[-+*/%&|^!=<>]=?|\.{3}|\?\?=?|\?\.?|[~:]/
});

Prism.languages.typescript = Prism.languages.extend('javascript', {
    'class-name': {
        pattern: /(\b(?:class|extends|implements|instanceof|interface|new|type)\s+)(?!async)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?:\s*<(?:[^<>]|<[^<>]*>)*>)?/,
        lookbehind: true,
        inside: { punctuation: /[<>.,]/ }
    },
    keyword: /\b(?:abstract|as|asserts|async|await|break|case|catch|class|const|constructor|continue|debugger|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|is|keyof|let|module|namespace|new|null|of|package|private|protected|public|readonly|return|set|static|super|switch|this|throw|try|type|typeof|undefined|var|void|while|with|yield)\b/,
    builtin: /\b(?:any|boolean|never|number|object|string|symbol|unknown)\b/
});

Prism.languages.ts = Prism.languages.typescript;
