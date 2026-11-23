const auth = require("./auth.middleware");
const authorization = require("./authorization.middleware");
const validation = require("./validation.middleware");
const sanitize = require("./sanitize.middleware");
const error = require("./error.middleware");

module.exports = {
	...auth,
	...authorization,
	...validation,
	...sanitize,
	...error,
};
