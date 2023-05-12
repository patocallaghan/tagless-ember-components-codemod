const j = require('jscodeshift').withParser('ts');
const _debug = require('debug')('tagless-ember-components-codemod');

const SilentError = require('../silent-error');
const {
  findTagName,
  findElementId,
  findClassNames,
  findClassNameBindings,
  findAttributeBindings,
  findAriaRole,
  isMethod,
  isProperty,
} = require('../utils/classic');

const EVENT_HANDLER_METHODS = [
  // Touch events
  'touchStart',
  'touchMove',
  'touchEnd',
  'touchCancel',

  // Keyboard events
  'keyDown',
  'keyUp',
  'keyPress',

  // Mouse events
  'mouseEnter',
  'mouseLeave',
  'mouseDown',
  'mouseUp',
  'contextMenu',
  'click',
  'doubleClick',
  'focusIn',
  'focusOut',

  // Form events
  'submit',
  'change',
  'focusIn',
  'focusOut',
  'input',

  // Drag and drop events
  'dragStart',
  'drag',
  'dragEnter',
  'dragLeave',
  'dragOver',
  'dragEnd',
  'drop',
];

module.exports = function transformClassicComponent(root, options) {
  let debug = options.debug || _debug;

  let exportDefaultDeclarations = root.find(j.ExportDefaultDeclaration);

  if (exportDefaultDeclarations.length !== 1) {
    throw new SilentError(`Could not find \`export default Component.extend({ ... });\``);
  }

  let exportDefaultDeclaration = exportDefaultDeclarations.get();

  // find first `{ ... }` inside `Component.extend()` arguments
  let extendObjectArgs = exportDefaultDeclaration
    .get('declaration', 'arguments')
    .filter(path => path.value.type === 'ObjectExpression');

  let objectArg = extendObjectArgs[0];
  if (!objectArg) {
    throw new SilentError(
      `Could not find object argument in \`export default Component.extend({ ... });\``
    );
  }

  // find `tagName` property if it exists
  let properties = objectArg.get('properties');
  let tagName = findTagName(properties);

  // skip tagless components (silent)
  if (tagName === '') {
    debug('tagName: %o -> skip', tagName);
    return;
  }

  debug('tagName: %o', tagName);

  // Add CODE MIGRATION HINT for `this.element`
  let thisElementPaths = j(objectArg).find(j.MemberExpression, {
    object: { type: 'ThisExpression' },
    property: { name: 'element' },
  });
  if (thisElementPaths.length !== 0) {
    thisElementPaths.forEach(path => {
      let comment = j.commentLine(
        ' CODE MIGRATION HINT: `this.element` is not supported in Glimmer components. See TBC for more details on how to migrate.',
        true,
        false
      );
      while (path.parentPath.node.type !== 'Program') {
        path = path.parentPath;
        if (['ExpressionStatement'].includes(path.node.type)) {
          path.node.comments = path.node.comments || [];
          let hasExistingAsyncComment = path.node.comments.find(c =>
            c.value.includes('`this.element` is not supported in Glimmer components.')
          );
          if (!hasExistingAsyncComment) {
            path.node.comments.push(comment);
          }
          break;
        }
      }
    });
  }

  let thisElementIdPaths = j(objectArg).find(j.MemberExpression, {
    object: { type: 'ThisExpression' },
    property: { name: 'elementId' },
  });
  if (thisElementIdPaths.length !== 0) {
    thisElementIdPaths.forEach(path => {
      let comment = j.commentLine(
        ' CODE MIGRATION HINT: `this.elementId` is not supported in Glimmer components. See TBC for more details on how to migrate.',
        true,
        false
      );
      while (path.parentPath.node.type !== 'Program') {
        path = path.parentPath;
        if (['ExpressionStatement'].includes(path.node.type)) {
          path.node.comments = path.node.comments || [];
          let hasExistingAsyncComment = path.node.comments.find(c =>
            c.value.includes('`this.elementId` is not supported in Glimmer components.')
          );
          if (!hasExistingAsyncComment) {
            path.node.comments.push(comment);
          }
          break;
        }
      }
    });
  }

  for (let methodName of EVENT_HANDLER_METHODS) {
    let handlerMethod = properties.filter(path => isMethod(path, methodName))[0];
    if (handlerMethod) {
      let comment = j.commentLine(
        ` CODE MIGRATION HINT: \`${methodName}\` is not supported in Glimmer components. See TBC for more details on how to migrate.`,
        true,
        false
      );
      handlerMethod.node.comments = handlerMethod.node.comments || [];
      let hasExistingAsyncComment = handlerMethod.node.comments.find(c =>
        c.value.includes('`this.elementId` is not supported in Glimmer components.')
      );
      if (!hasExistingAsyncComment) {
        handlerMethod.node.comments.push(comment);
      }
    }
  }

  // analyze `elementId`, `attributeBindings`, `classNames` and `classNameBindings`
  let elementId = findElementId(properties);
  debug('elementId: %o', elementId);

  let attributeBindings = findAttributeBindings(properties);
  debug('attributeBindings: %o', attributeBindings);

  let classNames = findClassNames(properties);
  debug('classNames: %o', classNames);

  let classNameBindings = findClassNameBindings(properties);
  debug('classNameBindings: %o', classNameBindings);

  let ariaRole;
  try {
    ariaRole = findAriaRole(properties);
  } catch (error) {
    throw new SilentError('Codemod does not support computed properties for `ariaRole`.');
  }
  debug('ariaRole: %o', ariaRole);

  // set `tagName: ''`
  let tagNamePath = j(properties)
    .find(j.ObjectProperty)
    .filter(path => path.parentPath === properties)
    .filter(path => isProperty(path, 'tagName'));

  if (tagNamePath.length === 1) {
    j(tagNamePath.get('value')).replaceWith(j.stringLiteral(''));
  } else {
    properties.unshift(j.objectProperty(j.identifier('tagName'), j.stringLiteral('')));
  }

  // remove `elementId`, `attributeBindings`, `classNames` and `classNameBindings`
  j(properties)
    .find(j.ObjectProperty)
    .filter(path => path.parentPath === properties)
    .filter(
      path =>
        isProperty(path, 'elementId') ||
        isProperty(path, 'attributeBindings') ||
        isProperty(path, 'classNames') ||
        isProperty(path, 'classNameBindings') ||
        isProperty(path, 'ariaRole')
    )
    .remove();

  let newSource = root.toSource();

  return {
    newSource,
    tagName,
    elementId,
    classNames,
    classNameBindings,
    attributeBindings,
    ariaRole,
  };
};
