const j = require('jscodeshift').withParser('ts');
const _debug = require('debug')('tagless-ember-components-codemod');

const SilentError = require('../silent-error');
const {
  findEventHandlers,
  findTagName,
  findElementId,
  findClassNames,
  findClassNameBindings,
  findAttributeBindings,
  findAriaRole,
  isProperty,
} = require('../utils/classic');
const { EVENT_HANDLER_METHODS } = require('../utils/common');

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

  // analyze `elementId`, `attributeBindings`, `classNames` and `classNameBindings`
  let elementId = findElementId(properties);
  debug('elementId: %o', elementId);

  let attributeBindings = findAttributeBindings(properties);
  debug('attributeBindings: %o', attributeBindings);

  let classNames = findClassNames(properties);
  debug('classNames: %o', classNames);

  let classNameBindings = findClassNameBindings(properties);
  debug('classNameBindings: %o', classNameBindings);

  let eventHandlers = findEventHandlers(properties);
  debug('eventHandlers: %o', eventHandlers);

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

  if (eventHandlers.length > 0) {
    newSource = j(newSource)
      .find(j.ObjectMethod)
      .filter(path => EVENT_HANDLER_METHODS.includes(path.node.key.name))
      .replaceWith(path => {
        const { params, body, async } = path.node;
        const handlerFunction = j.functionExpression(null, params, body);
        handlerFunction.async = async;
        const actionFunction = j.callExpression(j.identifier('action'), [handlerFunction]);
        return j.property(
          'init',
          j.identifier(
            `on${path.node.key.name.charAt(0).toUpperCase() + path.node.key.name.slice(1)}`
          ),
          actionFunction
        );
      })
      .toSource();

    const importStatement = j(newSource)
      .find(j.ImportDeclaration, {
        source: {
          value: '@ember/object',
        },
      })
      .filter(path => {
        const importedSpecifiers = path.node.specifiers;
        return importedSpecifiers.some(specifier => specifier.local.name === 'action');
      });

    if (importStatement.length === 0) {
      const ast = j(newSource);
      const existingImport = ast.find(j.ImportDeclaration, {
        source: {
          value: '@ember/object',
        },
      });
      const importSpecifier = j.importSpecifier(j.identifier('action'));

      if (existingImport.length > 0) {
        // Import source already exists, add specifier to existing import declaration
        existingImport.forEach(path => {
          path.node.specifiers.push(importSpecifier);
        });
      } else {
        // Import source does not exist, create a new import declaration
        const importDeclaration = j.importDeclaration(
          [importSpecifier],
          j.literal('@ember/object')
        );

        // Find the last import declaration in the AST
        const lastImport = ast.find(j.ImportDeclaration).at(-1);

        if (lastImport.length > 0) {
          // Append the new import declaration after the last existing import
          lastImport.insertAfter(importDeclaration);
        } else {
          // No existing import declarations, add the new import declaration to the top of the AST
          ast.get().node.program.body.unshift(importDeclaration);
        }
      }
      newSource = ast.toSource();
    }
  }

  return {
    newSource,
    tagName,
    elementId,
    classNames,
    classNameBindings,
    attributeBindings,
    eventHandlers,
    ariaRole,
  };
};
