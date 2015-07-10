var _ = require('underscore');

function Visitor(path, errors) {
  this.path = path || 'body';
  this.errors = errors || [];
}

Visitor.prototype.enter = function(elem) {
  return new Visitor(this.path + '.' + elem, this.errors);
};

Visitor.prototype.enterArray = function(i) {
  return new Visitor(this.path + '[' + i + ']', this.errors);
};

Visitor.prototype.report = function (reason) {
  this.errors.push(this.path + ': ' + reason);

  return null;
};

Visitor.prototype.checkType = function (val, type) {
  if (typeof(val) === type)
    return val;

  this.report('should be a ' + type);

  return null;
};

Visitor.prototype.checkFun = function (val, fun, reason) {
  if (fun(val))
    return val;

  this.report(reason || 'failed ' + getFunctionName(fun));

  return null;
};

Visitor.prototype.hasErrors = function () {
  return this.errors.length > 0;
};

function Optional(spec) {
  this.opt = spec;
}

function Multiple(specs) {
  this.mult = specs;
}

function paperwork(spec, val, visitor) {
  if (spec instanceof Optional)
    return val ? paperwork(spec.opt, val, visitor) : null;

  if (val === undefined)
    return visitor.report('missing');

  if (_.isRegExp(spec)) {
    if (typeof(val) !== 'string')
      return visitor.report('should be a string');

    if (!spec.test(val))
      return visitor.report('should match ' + spec);

    return val;
  }

  if (spec === String)
    return visitor.checkType(val, 'string');

  if (spec === Boolean)
    return visitor.checkType(val, 'boolean');

  if (spec === Number)
    return visitor.checkType(val, 'number');
  
  if (spec === Date)
    return visitor.checkFun(new Date(val), isValidDate, 'should be a Date');

  if (spec === Array)
    return visitor.checkType(val, _.isArray, 'should be an array');

  if (spec instanceof Multiple) {
    var allGood = _.all(spec.mult, function (spec) {
      return paperwork(spec, val, visitor) !== null;
    });

    return allGood ? val : null;
  }

  if (_.isFunction(spec))
    return visitor.checkFun(val, spec, null);

  if (_.isArray(spec)) {
    if (spec.length !== 1)
      throw new Error('array must contain exactly 1 sample value');

    var itemSpec = spec[0];

    if (!visitor.checkFun(val, _.isArray, 'should be an array'))
      return null;

    return _(val).map(function (item, i) {
      return paperwork(itemSpec, item, visitor.enterArray(i));
    });
  }
  
  if (isValidDate(spec)) {
    return new Date(val);
  }

  if (_.isObject(spec)) {
    if (!visitor.checkFun(val, _.isObject, 'should be an object'))
      return null;

    var res = {};

    _(spec).each(function (subspec, field) {
      res[field] = paperwork(subspec, val[field], visitor.enter(field));
    });

    return res;
  }
}

function getFunctionName(fun) {
  return fun.name || 'custom validator';
}

function isValidDate(date) {
  return (_.isDate(date) && !_.isNaN(date.getTime()));
}

module.exports = function (spec, blob, done) {
  var visitor = new Visitor(),
      validated = paperwork(spec, blob, visitor);

  if (visitor.hasErrors())
    done(visitor.errors);
  else
    done(null, validated);
};

module.exports.accept = function (spec) {
  return function (req, res, next) {
    if (!req.body)
      throw new Error('express.bodyParser() not enabled');

    var visitor = new Visitor(),
        validated = paperwork(spec, req.body, visitor);

    if (!visitor.hasErrors()) {
      req.body = validated;

      return next();
    }

    var error = new Error('Body did not satisfy requirements');
    error.status = 400;
    error.errors = visitor.errors;

    next(error);
  };
};

module.exports.validator = function (spec) {
  return module.exports.bind(null, spec);
};

module.exports.optional = function (spec) {
  return new Optional(spec);
};

module.exports.all = function () {
  return new Multiple(Array.prototype.slice.call(arguments));
};
