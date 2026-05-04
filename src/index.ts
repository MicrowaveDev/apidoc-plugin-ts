import * as ts from 'typescript'
import * as path from 'path'
import { Project as Ast, InterfaceDeclaration, PropertySignature, Symbol, SourceFile, NamespaceDeclaration } from 'ts-morph'

export const APIDOC_PLUGIN_TS_CUSTOM_ELEMENT_NAME = 'apiinterface'

const definitionFilesAddedByUser: {[key: string]: boolean} = {}

namespace Apidoc {
  export enum AvailableHook {
    'parser-find-elements' = 'parser-find-elements'
  }

  export interface App {
    addHook (name: AvailableHook, func: Function, priority?: number)
  }

  export interface Element {
    source: string
    name: string
    sourceName: string
    content: string
  }

  export type ParserFindElementsHookCallback = (
    elements: Element[],
    element: Element,
    block: string,
    filename: string
  ) => void
}

const ast = new Ast()

/**
 * Initialise plugin (add app hooks)
 * @param app
 */
export function init (app: Apidoc.App) {
  app.addHook(Apidoc.AvailableHook['parser-find-elements'], parseElements.bind(app), 200)
}

/**
 * Parse elements
 * @param elements
 * @param element
 * @param block
 * @param filename
 */
function parseElements (elements: Apidoc.Element[], element: Apidoc.Element, block: string, filename: string) {

  // We only want to do things with the instance of our custom element.
  if (element.name !== APIDOC_PLUGIN_TS_CUSTOM_ELEMENT_NAME) return

  // Remove the element
  elements.pop()

  // Create array of new elements
  const newElements: Apidoc.Element[] = []

  // Get object values
  const values = parse(element.content)

  // Only if there are values...
  if (!values) {
    this.log.warn(`Could not find parse values of element: ${element.content}`)
    return
  }

  // The interface we are looking for
  const namedInterface = values.interface.trim()

  // Get the file path to the interface
  const interfacePath = values.path ? path.resolve(path.dirname(filename), values.path.trim()) : filename
  const parentNamespace = parseDefinitionFiles.call(this, interfacePath)
  const { namespace, leafName } = extractNamespace.call(this, parentNamespace, namedInterface)

  if (isNativeType(leafName)) {
    parseNative(elements, newElements, interfacePath, values)
    return
  }
  const arrayMatch = matchArrayInterface(leafName)
  if (arrayMatch) {
    parseArray.call(this, elements, newElements, values, interfacePath, namespace, arrayMatch)
    return
  }
  parseInterface.call(this, elements, newElements, values, interfacePath, namespace, leafName)
  // Does the interface exist in current file?
}

function parseNative (elements: Apidoc.Element[], newElements: Apidoc.Element[], interfacePath: string, values: ParseResult) {
  setNativeElements(interfacePath, newElements, values)
  elements.push(...newElements)

}

function parseArray (elements: Apidoc.Element[], newElements: Apidoc.Element[], values: ParseResult, interfacePath: string, namespace: NamespaceDeclaration, arrayMatch: ArrayMatch) {
  const leafName = arrayMatch.interface
  const matchedInterface = getNamespacedInterface(namespace, leafName)
  if (!matchedInterface) {
    this.log.warn(`Could not find interface «${leafName}» in file «${interfacePath}»`)
    return
  }
  setArrayElements.call(this, matchedInterface, interfacePath, newElements, values)
  elements.push(...newElements)

}

function parseInterface (elements: Apidoc.Element[], newElements: Apidoc.Element[], values: ParseResult, interfacePath: string, namespace: NamespaceDeclaration, leafName: string) {
  const matchedInterface = getNamespacedInterface(namespace, leafName)

  // If interface is not found, log error
  if (!matchedInterface) {
    this.log.warn(`Could not find interface «${values.interface}» in file «${interfacePath}»`)
    return
  }

  // Match elements of current interface
  setInterfaceElements.call(this, matchedInterface, interfacePath, newElements, values)

  // Push new elements into existing elements
  elements.push(...newElements)
}

interface ParseResult {
  targetElement: ApiElement
  field: string
  interface: string
  path: string
}

interface ArrayMatch {
  full: string
  interface: string
}

/**
 * Parse element content
 * @param content
 */
function parse (content: string): ParseResult | null {
  if (content.length === 0) return null

  const parseRegExp = /^(?:\((.+?)\)){0,1}\s*\{(.+?)\}\s*(?:(.+))?/g
  const matches = parseRegExp.exec(content)

  if (!matches) return null
  const suffix = matches[3] ? matches[3].trim() : ''
  const targetElement = getTargetElement(suffix)

  return {
    targetElement,
    field: targetElement.name === 'apisuccess' ? suffix : '',
    interface: matches[2],
    path: matches[1]
  }
}

/**
 *
 * @param matchedInterface
 * @param filename
 * @param newElements
 * @param values
 * @param inttype
 */
function setArrayElements (
    matchedInterface: InterfaceDeclaration,
    filename: string,
    newElements: Apidoc.Element[],
    values: ParseResult,
    inttype?: string
) {
  const name = values.field
  newElements.push(getApiElement(values.targetElement, `{Object[]} ${name} ${name}`))
  setInterfaceElements.call(this, matchedInterface, filename, newElements, values, name)
}
/**
 *
 * @param matchedInterface
 * @param filename
 * @param newElements
 * @param values
 * @param inttype
 */
function setInterfaceElements (
  matchedInterface: InterfaceDeclaration,
  filename: string,
  newElements: Apidoc.Element[],
  values: ParseResult,
  inttype?: string
) {
  // If this is an extended interface
  extendInterface.call(this, matchedInterface, filename, newElements, values, inttype)

  // Iterate over interface properties
  matchedInterface.getProperties().forEach((prop: PropertySignature) => {
    // Set param type definition and description
    const typeDef = inttype ? `${inttype}.${prop.getName()}` : prop.getName()
    const documentationComments = prop.getJsDocs().map((node) => node.getInnerText()).join()
    const description = documentationComments
      ? `\`${typeDef}\` - ${documentationComments}`
      : `\`${typeDef}\``

    // Set property type as a string
    const propType = prop.getType().getText()

    // Determine if the type is an object
    const propTypeIsObject = !isNativeType(propType)

    // If type is an object change label
    const isArray = propTypeIsObject && propType.includes('[]')
    const propLabel = propTypeIsObject
      ? `Object${isArray ? '[]' : ''}`
      : getCapitalized(propType)

    // Set the element
    newElements.push(getApiElement(values.targetElement, `{${propLabel}} ${typeDef} ${description}`))

    // If property is an object or interface then we need to also display the objects properties
    if (propTypeIsObject) {
      // First determine if the object is an available interface
      const typeInterface = getInterface.call(this, filename, propType)

      const arrayType = isArray && prop.getType().getArrayElementType()
      const objectProperties = arrayType
        ? arrayType.getProperties()
        : prop.getType().getProperties()

      if (typeInterface) {
        setInterfaceElements.call(this, typeInterface, filename, newElements, values, typeDef)
      } else {
        setObjectElements.call(this, objectProperties, filename, newElements, values, typeDef)
      }
    }
  })
}

/**
 *
 * @param filename
 * @param newElements
 * @param values
 */
function setNativeElements (
  filename: string,
  newElements: Apidoc.Element[],
  values: ParseResult
  // inttype?: string
) {

  const propLabel = getCapitalized(values.interface)
  // Set the element
  newElements.push(getApiElement(values.targetElement, `{${propLabel}} ${values.field}`))
  return
}

/**
 * Set element if type object
 */
function setObjectElements<NodeType extends ts.Node = ts.Node> (
  properties: Symbol[],
  filename: string,
  newElements: Apidoc.Element[],
  values: ParseResult,
  typeDef: string
) {
  properties.forEach((property) => {
    const valueDeclaration = property.getValueDeclaration()
    if (!valueDeclaration) return

    const propName = property.getName()
    const typeDefLabel = `${typeDef}.${propName}`
    const propType = valueDeclaration.getType().getText(valueDeclaration)

    const isUserDefinedProperty = isUserDefinedSymbol(property.compilerSymbol)
    if (!isUserDefinedProperty) return // We don't want to include default members in the docs

    const documentationComments = property.compilerSymbol.getDocumentationComment(undefined).map((node) => node.text).join()

    const desc = documentationComments
      ? `\`${typeDef}.${propName}\` - ${documentationComments}`
      : `\`${typeDef}.${propName}\``

    // Nothing to do if prop is of native type
    if (isNativeType(propType)) {
      newElements.push(getApiElement(values.targetElement, `{${getCapitalized(propType)}} ${typeDefLabel} ${desc}`))
      return
    }

    const newElement = getApiElement(values.targetElement, `{Object${propType.includes('[]') ? '[]' : ''}} ${typeDefLabel} ${desc}`)
    newElements.push(newElement)

    // If property is an object or interface then we need to also display the objects properties
    const typeInterface = getInterface.call(this, filename, propType)

    if (typeInterface) {
      setInterfaceElements.call(this, typeInterface, filename, newElements, values, typeDefLabel)
    } else {

      const externalFileTypeSymbol = valueDeclaration.getType().getSymbol()
      if (!externalFileTypeSymbol) {
        setObjectElements.call(
          this,
          property.getValueDeclarationOrThrow().getType().getProperties(),
          filename,
          newElements,
          values,
          typeDef
        )
        return
      }

      const externalFileDeclaration = externalFileTypeSymbol.getDeclarations()[0]
      const externalFileInterface = externalFileDeclaration.getSourceFile().getInterface(propType)

      if (!externalFileInterface) {
        setObjectElements.call(
          this,
          property.getValueDeclarationOrThrow().getType().getProperties(),
          filename,
          newElements,
          values,
          typeDefLabel
        )
        return
      }

      setObjectElements.call(
        this,
        externalFileInterface.getType().getProperties(),
        filename,
        newElements,
        values,
        typeDefLabel
      )
    }
  })
}

/**
 * Extends the current interface
 * @param matchedInterface
 * @param interfacePath
 * @param newElements
 * @param values
 */
function extendInterface (
  matchedInterface: InterfaceDeclaration,
  interfacePath: string,
  newElements: Apidoc.Element[],
  values: ParseResult,
  inttype?: string
) {
  for (const extendedInterface of matchedInterface.getExtends()) {
    const extendedInterfaceName = extendedInterface.compilerNode.expression.getText()
    if (isIgnoredExtendedType(extendedInterfaceName)) continue
    const parentNamespace = matchedInterface.getParentNamespace() || parseDefinitionFiles.call(this, interfacePath)
    const { namespace, leafName } = extractNamespace.call(this, parentNamespace, extendedInterfaceName)
    const matchedExtendedInterface = getNamespacedInterface.call(this, namespace, leafName)
    if (!matchedExtendedInterface) {
      this.log.warn(`Could not find interface to be extended ${extendedInterfaceName}`)
      return
    }

    extendInterface.call(this, matchedExtendedInterface, interfacePath, newElements, values)
    setInterfaceElements.call(this, matchedExtendedInterface, interfacePath, newElements, values, inttype)
  }
}

interface ApiElement {
  name: string
  sourceName: string
}

const API_SUCCESS_ELEMENT: ApiElement = {
  name: 'apisuccess',
  sourceName: 'apiSuccess'
}

function getTargetElement (suffix: string): ApiElement {
  if (suffix === 'apiParam') {
    return {
      name: 'apiparam',
      sourceName: 'apiParam'
    }
  }

  return API_SUCCESS_ELEMENT
}

function getApiElement (element: ApiElement, param: string | number): Apidoc.Element {
  return {
    content: `${param}\n`,
    name: element.name,
    source: `@${element.sourceName} ${param}\n`,
    sourceName: element.sourceName
  }
}

type NamespacedContext = SourceFile | NamespaceDeclaration
interface NamespacedDeclaration {
  declaration: InterfaceDeclaration
  parentNamespace: NamespacedContext
}

function parseDefinitionFiles (interfacePath: string): SourceFile | undefined {
  const interfaceFile = ast.addExistingSourceFile(interfacePath)
  if (!interfaceFile) return

  trackUserAddedDefinitionFile(interfaceFile)
  for (const file of ast.resolveSourceFileDependencies()) {
    trackUserAddedDefinitionFile(file)
  }
  return interfaceFile
}

function extractNamespace (
  rootNamespace: NamespacedContext,
  interfaceName: string
): { namespace: NamespaceDeclaration | undefined; leafName: string; } {
  const isNamespaced = interfaceName.match(/(?:[a-zA-Z0-9_]\.)*[a-zA-Z0-9_]\./i)

  const nameSegments = isNamespaced
    ? interfaceName.replace('[]', '').split('.')
    : [interfaceName]

  const namespaces = nameSegments.slice(0, -1)
  const leafName = nameSegments[nameSegments.length - 1]

  const namespace = namespaces.reduce(
    (parent: NamespacedContext | undefined, name: string) => {
      if (!parent) return
      const namespace = parent.getNamespace(name)
      if (!namespace) this.log.warn(`Could not find namespace ${name} in root namespace in file at ${rootNamespace.getSourceFile().getFilePath()}`)
      return namespace
    },
    rootNamespace
  ) as NamespaceDeclaration | undefined
  return {
    namespace,
    leafName
  }
}

function getNamespacedInterface (
  namespace: NamespaceDeclaration,
  interfaceName: string
): InterfaceDeclaration | undefined {
  return namespace.getInterface(interfaceName)
}
function getInterface (interfacePath: string, interfaceName: string): InterfaceDeclaration | undefined {
  const interfaceFile = parseDefinitionFiles(interfacePath)
  const { namespace, leafName } = extractNamespace.call(this, interfaceFile, interfaceName)
  return getNamespacedInterface.call(this, namespace, leafName)
}

function trackUserAddedDefinitionFile (file: SourceFile) {
  definitionFilesAddedByUser[file.getFilePath()] = true
}

function getCapitalized (text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

function isNativeType (propType: string): boolean {
  const nativeTypes = ['boolean', 'Boolean', 'string', 'String', 'number', 'Number', 'Date', 'any']
  return nativeTypes.indexOf(propType) >= 0
}

function isIgnoredExtendedType (typeName: string): boolean {
  return typeName === 'Record' || typeName.startsWith('Record<')
}

function matchArrayInterface (interfaceName): ArrayMatch | null {
  const match = interfaceName.match(/^Array<(.*)>$/) || interfaceName.match(/^(.*)\[\]$/)
  if (!match) {
    return null
  }
  return {
    full: interfaceName,
    interface: match[1]
  }
}

function isUserDefinedSymbol (symbol: ts.Symbol): boolean {
  const declarationFile = symbol.valueDeclaration.parent.getSourceFile()
  return definitionFilesAddedByUser[declarationFile.fileName]
}
