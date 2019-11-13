var Config = require("./config"),
    extend = require("./utils/extend").extend,
    OptionManager = require("./option_manager").OptionManager,
    Class = require("./class"),
    Action = require("./action"),
    errors = require("./errors"),
    commonUtils = require("./utils/common"),
    typeUtils = require("./utils/type"),
    deferredUtils = require("../core/utils/deferred"),
    Deferred = deferredUtils.Deferred,
    when = deferredUtils.when,
    Callbacks = require("./utils/callbacks"),
    EventsMixin = require("./events_mixin"),
    publicComponentUtils = require("./utils/public_component"),

    isFunction = typeUtils.isFunction,
    noop = commonUtils.noop;

/**
* @name Component
* @type object
* @inherits EventsMixin
* @module core/component
* @export default
* @namespace DevExpress
* @hidden
*/

class PostponedOperations {
    constructor() {
        this._postponedOperations = {};
    }

    add(key, fn, postponedPromise) {
        if(key in this._postponedOperations) {
            postponedPromise && this._postponedOperations[key].promises.push(postponedPromise);
        } else {
            var completePromise = new Deferred();
            this._postponedOperations[key] = {
                fn: fn,
                completePromise: completePromise,
                promises: postponedPromise ? [postponedPromise] : []
            };
        }

        return this._postponedOperations[key].completePromise.promise();
    }

    callPostponedOperations() {
        for(var key in this._postponedOperations) {
            var operation = this._postponedOperations[key];

            if(typeUtils.isDefined(operation)) {
                if(operation.promises && operation.promises.length) {
                    when(...operation.promises).done(operation.fn).then(operation.completePromise.resolve);
                } else {
                    operation.fn().done(operation.completePromise.resolve);
                }
            }
        }
        this._postponedOperations = {};
    }
}

var Component = Class.inherit({
    _setDeprecatedOptions: function() {
        this._deprecatedOptions = {};
    },

    _getDeprecatedOptions: function() {
        return this._deprecatedOptions;
    },

    _getDefaultOptions: function() {
        return {
            /**
            * @name ComponentOptions.onInitialized
            * @type function
            * @type_function_param1 e:object
            * @type_function_param1_field1 component:this
            * @type_function_param1_field2 element:dxElement
            * @default null
            * @action
            */
            onInitialized: null,
            /**
            * @name ComponentOptions.onOptionChanged
            * @type function
            * @type_function_param1 e:object
            * @type_function_param1_field1 component:this
            * @type_function_param1_field4 name:string
            * @type_function_param1_field5 fullName:string
            * @type_function_param1_field6 value:any
            * @default null
            * @action
            */
            onOptionChanged: null,
            /**
            * @name ComponentOptions.onDisposing
            * @type function
            * @type_function_param1 e:object
            * @type_function_param1_field1 component:this
            * @default null
            * @action
            */
            onDisposing: null,

            defaultOptionsRules: null
        };
    },

    _defaultOptionsRules: function() {
        return [];
    },

    _setOptionsByDevice: function(rules) {
        this._optionManager.applyRules(rules);
    },

    _convertRulesToOptions: function(rules) {
        return OptionManager.convertRulesToOptions(rules);
    },

    _isInitialOptionValue: function(name) {
        return this._optionManager.isInitial(name);
    },

    _setOptionsByReference: function() {
        this._optionsByReference = {};
    },

    _getOptionsByReference: function() {
        return this._optionsByReference;
    },
    /**
    * @name ComponentMethods.ctor
    * @publicName ctor(options)
    * @param1 options:ComponentOptions|undefined
    * @hidden
    */
    ctor: function(options = {}) {
        this.NAME = publicComponentUtils.name(this.constructor);

        if(options.eventsStrategy) {
            this.setEventsStrategy(options.eventsStrategy);
        }

        this._updateLockCount = 0;

        this._optionChangedCallbacks = options._optionChangedCallbacks || Callbacks();
        this._disposingCallbacks = options._disposingCallbacks || Callbacks();
        this.postponedOperations = new PostponedOperations();
        this._initOptionManager(options);
    },

    _initOptionManager(options) {
        this.beginUpdate();

        try {
            this._setOptionsByReference();
            this._setDeprecatedOptions();
            this._options = this._getDefaultOptions();
            this._optionManager = new OptionManager(
                this._options,
                this._getDefaultOptions(),
                this._getOptionsByReference(),
                this._getDeprecatedOptions()
            );

            this._optionManager.onChanging(
                (name, previousValue, value) => this._initialized && this._optionChanging(name, previousValue, value));
            this._optionManager.onDeprecated(
                (option, info) => this._logDeprecatedWarning(option, info));
            this._optionManager.onChanged(
                (name, value, previousValue) => this._notifyOptionChanged(name, value, previousValue));
            this._optionManager.addRules(this._defaultOptionsRules());

            if(options && options.onInitializing) {
                options.onInitializing.apply(this, [options]);
            }

            this._setOptionsByDevice(options.defaultOptionsRules);
            this._initOptions(options);
        } finally {
            this.endUpdate();
        }
    },

    _initOptions: function(options) {
        this.option(options);
    },

    _init: function() {
        this._createOptionChangedAction();

        this.on("disposing", function(args) {
            this._disposingCallbacks.fireWith(this, [args]);
        }.bind(this));
    },

    _logDeprecatedWarning(option, info) {
        var message = info.message || ("Use the '" + info.alias + "' option instead");
        errors.log("W0001", this.NAME, option, info.since, message);
    },

    _createOptionChangedAction: function() {
        this._optionChangedAction = this._createActionByOption("onOptionChanged", { excludeValidators: ["disabled", "readOnly"] });
    },

    _createDisposingAction: function() {
        this._disposingAction = this._createActionByOption("onDisposing", { excludeValidators: ["disabled", "readOnly"] });
    },

    _optionChanged: function(args) {
        switch(args.name) {
            case "onDisposing":
            case "onInitialized":
                break;
            case "onOptionChanged":
                this._createOptionChangedAction();
                break;
            case "defaultOptionsRules":
                break;
        }
    },

    _dispose: function() {
        this._optionChangedCallbacks.empty();
        this._createDisposingAction();
        this._disposingAction();
        this._disposeEvents();
        this._optionManager.dispose();
        this._disposed = true;
    },

    /**
     * @name componentmethods.instance
     * @publicName instance()
     * @return this
     */
    instance: function() {
        return this;
    },

    /**
     * @name componentmethods.beginupdate
     * @publicName beginUpdate()
     */
    beginUpdate: function() {
        this._updateLockCount++;
    },

    /**
     * @name componentmethods.endupdate
     * @publicName endUpdate()
     */
    endUpdate: function() {
        this._updateLockCount = Math.max(this._updateLockCount - 1, 0);
        if(!this._updateLockCount) {
            this.postponedOperations.callPostponedOperations();
            if(!this._initializing && !this._initialized) {
                this._initializing = true;
                try {
                    this._init();
                } finally {
                    this._initializing = false;
                    this._updateLockCount++;
                    this._createActionByOption("onInitialized", { excludeValidators: ["disabled", "readOnly"] })();
                    this._updateLockCount--;
                    this._initialized = true;
                }
            }
        }
    },

    _optionChanging: noop,

    _notifyOptionChanged: function(option, value, previousValue) {
        var that = this;

        if(this._initialized) {
            var optionNames = [option].concat(this._optionManager.getAliasesByName(option));
            for(var i = 0; i < optionNames.length; i++) {
                var name = optionNames[i],
                    args = {
                        name: name.split(/[.[]/)[0],
                        fullName: name,
                        value: value,
                        previousValue: previousValue
                    };

                that._optionChangedCallbacks.fireWith(that, [extend(that._defaultActionArgs(), args)]);
                that._optionChangedAction(extend({}, args));

                if(!that._disposed && this._cancelOptionChange !== args.name) {
                    that._optionChanged(args);
                }
            }
        }
    },

    initialOption: function(name) {
        return this._optionManager.initial(name);
    },

    _defaultActionConfig: function() {
        return {
            context: this,
            component: this
        };
    },

    _defaultActionArgs: function() {
        return {
            component: this
        };
    },

    _createAction: function(actionSource, config) {
        var that = this,
            action;

        return function(e) {
            if(!arguments.length) {
                e = {};
            }

            if(!typeUtils.isPlainObject(e)) {
                e = { actionValue: e };
            }

            action = action || new Action(actionSource, extend(config, that._defaultActionConfig()));

            return action.execute.call(action, extend(e, that._defaultActionArgs()));
        };
    },

    _createActionByOption: function(optionName, config) {
        var that = this,
            action,
            eventName,
            actionFunc;

        var result = function() {
            if(!eventName) {
                config = config || {};

                if(typeof optionName !== "string") {
                    throw errors.Error("E0008");
                }

                if(optionName.indexOf("on") === 0) {
                    eventName = that._getEventName(optionName);
                }
                ///#DEBUG
                if(optionName.indexOf("on") !== 0) {
                    throw Error("The '" + optionName + "' option name should start with 'on' prefix");
                }
                ///#ENDDEBUG

                actionFunc = that.option(optionName);
            }

            if(!action && !actionFunc && !config.beforeExecute && !config.afterExecute && !that.hasEvent(eventName)) {
                return;
            }

            if(!action) {
                var beforeExecute = config.beforeExecute;
                config.beforeExecute = function(args) {
                    beforeExecute && beforeExecute.apply(that, arguments);
                    that.fireEvent(eventName, args.args);
                };
                action = that._createAction(actionFunc, config);
            }

            if(Config().wrapActionsBeforeExecute) {
                var beforeActionExecute = that.option("beforeActionExecute") || noop;
                var wrappedAction = beforeActionExecute(that, action, config) || action;
                return wrappedAction.apply(that, arguments);
            }

            return action.apply(that, arguments);
        };

        if(!Config().wrapActionsBeforeExecute) {
            var onActionCreated = that.option("onActionCreated") || noop;
            result = onActionCreated(that, result, config) || result;
        }

        return result;
    },

    _getOptionByStealth: function(name) {
        return this._optionManager.silent(name);
    },

    _setOptionByStealth: function(options, value) {
        this._optionManager.silent(options, value);
    },

    _getEventName: function(actionName) {
        return actionName.charAt(2).toLowerCase() + actionName.substr(3);
    },

    hasActionSubscription: function(actionName) {
        return !!this.option(actionName) ||
            this.hasEvent(this._getEventName(actionName));
    },

    isOptionDeprecated: function(name) {
        return this._optionManager.isDeprecated(name);
    },

    _setOptionSilent: function(name, value) {
        this._cancelOptionChange = name;
        this.option(name, value);
        this._cancelOptionChange = false;
    },

    _getOptionValue: function(name, context) {
        var value = this.option(name);

        if(isFunction(value)) {
            return value.bind(context)();
        }

        return value;
    },

    /**
     * @name componentmethods.option
     * @publicName option()
     * @return object
     */
    /**
     * @name componentmethods.option
     * @publicName option(optionName)
     * @param1 optionName:string
     * @return any
     */
    /**
     * @name componentmethods.option
     * @publicName option(optionName, optionValue)
     * @param1 optionName:string
     * @param2 optionValue:any
     */
    /**
     * @name componentmethods.option
     * @publicName option(options)
     * @param1 options:object
     */
    option: function(options, value) {
        if(arguments.length < 2 && typeUtils.type(options) !== "object") {
            return this._optionManager.option(options);
        } else {
            this.beginUpdate();

            try {
                this._optionManager.option(options, value);
            } finally {
                this.endUpdate();
            }
        }
    },

    /**
     * @name componentmethods.resetOption
     * @publicName resetOption(optionName)
     * @param1 optionName:string
     */
    resetOption: function(name) {
        this.beginUpdate();
        this._optionManager.reset(name);
        this.endUpdate();
    }
}).include(EventsMixin);

module.exports = Component;
module.exports.PostponedOperations = PostponedOperations;
