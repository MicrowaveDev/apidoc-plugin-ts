import { expect } from 'chai'
import 'mocha'
import * as apidoc from 'apidoc'
import * as fs from 'fs-extra'
import * as path from 'path'
const tests = [
  {
    only: false,
    name: 'test1'
  },
  {
    skip: true,
    name: 'array-with-type-aliases'
  },
  {
    name: 'array-in-types'
  },
  {
    only: false,
    name: 'native-types'
  },
  {
    only: false,
    name: 'array-as-properties'
  },
  {
    only: false,
    name: 'namespaces'
  },
  {
    only: false,
    name: 'geesome-api-param-record'
  },
  {
    only: false,
    name: 'geesome-api-body-record'
  }
]
describe('Apidoc TS Plugin', () => {
  tests.forEach(function (test) {
    (test.only ? it.only : (test.skip ? it.skip : it))(test.name, async function () {
      const dest = `out/${test.name}`
      const result = apidoc.createDoc({
        src: [`${test.name}`],
        debug: false,
        dest
      })
      const outputJson = normalizeApiData(JSON.parse(result.data), test.name)
      const expectedJson = await fs.readJson(path.join(test.name, 'fixture.json'))
      expect(outputJson).to.deep.equal(expectedJson)
    })
  })
})

function normalizeApiData (items: any[], testName: string): any[] {
  return items.map((item) => normalizeApiDataValue({
    ...item,
    filename: item.filename.includes('/') ? item.filename : `${testName}/${item.filename}`
  }))
}

function normalizeApiDataValue (value: any): any {
  if (Array.isArray(value)) return value.map(normalizeApiDataValue)
  if (!value || typeof value !== 'object') return value

  return Object.keys(value).reduce((normalized, key) => {
    if (key === 'isArray' || key === 'parentNode') return normalized
    normalized[key] = normalizeApiDataValue(value[key])
    return normalized
  }, {})
}
