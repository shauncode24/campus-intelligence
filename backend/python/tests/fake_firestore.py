"""
A small in-memory stand-in for the parts of the Firestore API the backend uses
(collections, documents, where ==/in, select, limit, order_by, batches). Lets
tests run the REAL repository/service code without a database.
"""
import itertools

from firebase_admin import firestore as _fs

_auto_ids = itertools.count(1)


def _plain(data):
    """Resolve Firestore sentinels the way the server would."""
    out = {}
    for k, v in data.items():
        if v is _fs.SERVER_TIMESTAMP:
            out[k] = "SERVER_TIMESTAMP"
        elif type(v).__name__ == "Increment":
            out[k] = 1
        elif isinstance(v, dict):
            out[k] = _plain(v)
        else:
            out[k] = v
    return out


class FakeSnapshot:
    def __init__(self, ref, data):
        self.reference, self._data, self.id = ref, data, ref.id

    exists = property(lambda self: self._data is not None)

    def to_dict(self):
        return None if self._data is None else dict(self._data)


class FakeDocRef:
    def __init__(self, collection, doc_id):
        self.collection, self.id = collection, doc_id

    def get(self):
        return FakeSnapshot(self, self.collection.docs.get(self.id))

    def set(self, data):
        self.collection.docs[self.id] = _plain(data)

    def update(self, data):
        if self.id not in self.collection.docs:
            raise KeyError(f"No document to update: {self.collection.name}/{self.id}")
        self.collection.docs[self.id].update(_plain(data))

    def delete(self):
        self.collection.docs.pop(self.id, None)


class FakeQuery:
    def __init__(self, collection, filters=(), max_docs=None):
        self.collection, self.filters, self.max_docs = collection, filters, max_docs

    def where(self, field, op, value):
        return FakeQuery(self.collection, self.filters + ((field, op, value),), self.max_docs)

    def select(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def limit(self, n):
        return FakeQuery(self.collection, self.filters, n)

    def _matches(self, data):
        for field, op, value in self.filters:
            if op == "==" and data.get(field) != value:
                return False
            if op == "in" and data.get(field) not in value:
                return False
        return True

    def stream(self):
        rows = [
            FakeSnapshot(FakeDocRef(self.collection, doc_id), data)
            for doc_id, data in list(self.collection.docs.items())
            if self._matches(data)
        ]
        return rows[: self.max_docs] if self.max_docs else rows

    def get(self):
        return self.stream()


class FakeCollection(FakeQuery):
    def __init__(self, name):
        self.name, self.docs = name, {}
        super().__init__(self)

    def document(self, doc_id=None):
        return FakeDocRef(self, doc_id or f"auto{next(_auto_ids)}")

    def add(self, data):
        ref = self.document()
        ref.set(data)
        return (None, ref)


class FakeBatch:
    def __init__(self, db):
        self.db, self.ops = db, []

    def set(self, ref, data):
        self.ops.append(("set", ref, data))

    def update(self, ref, data):
        self.ops.append(("update", ref, data))

    def delete(self, ref):
        self.ops.append(("delete", ref, None))

    def commit(self):
        self.db.batch_sizes.append(len(self.ops))
        assert len(self.ops) <= 500, "Firestore batches are limited to 500 operations"
        for kind, ref, data in self.ops:
            getattr(ref, kind)(*([data] if data is not None else []))
        self.ops = []


class FakeDB:
    def __init__(self):
        self.collections = {}
        self.batch_sizes = []

    def collection(self, name):
        return self.collections.setdefault(name, FakeCollection(name))

    def batch(self):
        return FakeBatch(self)
