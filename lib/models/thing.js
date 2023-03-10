'use strict'

const { connect, createCollection } = require('../db')
const cleanObject = require('../utils/clean_object')
const { toExposedThing } = require('../utils/to_exposed_thing')
const toArray = require('../utils/to_array')

const collectionName = 'things'

function getTypes (description) {
  if (description['@type'] !== undefined) {
    if (Array.isArray(description['@type'])) {
      return description['@type']
    }
    return [description['@type']]
  }
}

function getType (unexposed) {
  if (unexposed === true) {
    return '$unexposed'
  } else {
    return '$exposed'
  }
}

async function init () {
  const db = await createCollection(collectionName)
  await db
    .collection(collectionName)
    .createIndex({ id: 1, user: 1 }, { unique: true })
}

async function findByIds (
  ids,
  { session, type, limit, skip, resolve, unexposed, owner } = {}
) {
  const query = {
    types: Array.isArray(type) ? { $all: type } : type,
    username: owner ? { $in: toArray(owner) } : undefined
  }
  const projection = {
    description: resolve === true ? getType(unexposed) : undefined,
    types: { $ifNull: ['$types', []] },
    id: 1,
    owner: '$username',
    title: 1,
    _id: 0
  }
  const pipeline = [
    {
      $match: {
        id: { $in: ids },
        ...cleanObject(query)
      }
    },
    {
      $project: {
        ...cleanObject(projection)
      }
    }
  ]

  if (limit !== undefined) {
    pipeline.push({ $limit: +limit })
  }

  if (skip !== undefined) {
    pipeline.push({ $skip: +skip })
  }

  const db = await connect()
  return db
    .collection(collectionName)
    .aggregate(pipeline, { session })
    .toArray()
}

async function findAll ({ session, projection } = {}) {
  const db = await connect()
  return db
    .collection(collectionName)
    .find({}, { session, projection })
    .toArray()
}

async function findOne (id, { session, unexposed } = {}) {
  const db = await connect()
  const [description] = await db
    .collection(collectionName)
    .aggregate(
      [
        {
          $match: {
            id
          }
        },
        {
          $project: {
            description: getType(unexposed),
            _id: 0
          }
        }
      ],
      { session }
    )
    .toArray()
  return description
}

async function existsById (id, { session } = {}) {
  const db = await connect()
  const result = await db
    .collection(collectionName)
    .findOne({ id }, { session, projection: { _id: 0, id: 1 } })
  return result !== null
}

async function create (description, user, username, { session, source } = {}) {
  const db = await connect()
  return db.collection(collectionName).insertOne(
    {
      exposed: toExposedThing(description),
      unexposed: description,
      user,
      username,
      id: description.id,
      types: getTypes(description),
      title: description.title,
      source
    },
    { session }
  )
}

async function updateById (description, { session, projection } = {}) {
  const db = await connect()
  return db.collection(collectionName).findOneAndUpdate(
    { id: description.id },
    {
      $set: {
        exposed: toExposedThing(description),
        unexposed: description,
        types: getTypes(description),
        title: description.title
      }
    },
    { session, projection }
  )
}

async function deleteById (id, { session } = {}) {
  const db = await connect()
  const { result } = await db
    .collection(collectionName)
    .deleteOne({ id }, { session })
  return result.ok === 1 && result.n > 0
}

exports = module.exports = {
  init,
  findByIds,
  findAll,
  findOne,
  existsById,
  create,
  updateById,
  deleteById
}
