"use strict";

// The `profileReexpression` config collaborator, wired exactly as the element wires it, for
// config tests that hand normalizeConfig() their own collaborator set. A custom profile's
// conversion is part of the config contract; a stand-in here would test a different one.
// See the collaborator list in the head of src/config/normalize-config.js.

const { findReexpressionFault, reexpressProfile } = require("../../src/domain/classification/reexpression.js");

module.exports = { PROFILE_REEXPRESSION: Object.freeze({ reexpress: reexpressProfile, findFault: findReexpressionFault }) };
