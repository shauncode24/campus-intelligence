"""
A small in-memory stand-in for the parts of the Firestore API the backend uses
(collections, documents, where ==/in, select, limit, order_by, batches). Lets
tests run the REAL repository/service code without a database.
"""
import itertools

from firebase_admin import firestore as _fs

_auto_ids = itertools.count(1)


class _Inc:
    """A pending Increment; resolved against the stored value when written."""
    def __init__(self, sentinel):
        self.by = getattr(sentinel, "value", None) or getattr(sentinel, "_value", 1)


def _plain(data):
    """Resolve Firestore sentinels the way the server would."""
    out = {}
    for k, v in data.items():
        if v is _fs.SERVER_TIMESTAMP:
            out[k] = "SERVER_TIMESTAMP"
        elif type(v).__name__ == "Increment":
            out[k] = _Inc(v)
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

    def set(self, data, merge=False):
        if merge and self.id in self.collection.docs:
            doc = self.collection.docs[self.id]
            for key, value in _plain(data).items():
                if isinstance(value, _Inc):
                    value = (doc.get(key) or 0) + value.by
                doc[key] = value
            return
        doc = _plain(data)
        for key, value in list(doc.items()):
            if isinstance(value, _Inc):
                doc[key] = value.by
        self.collection.docs[self.id] = doc

    def update(self, data):
        if self.id not in self.collection.docs:
            raise KeyError(f"No document to update: {self.collection.name}/{self.id}")
        doc = self.collection.docs[self.id]
        for key, value in _plain(data).items():
            target = doc
            *parents, leaf = key.split(".")          # 'metadata.favorite' updates inside the map
            for part in parents:
                target = target.setdefault(part, {})
            if value is _fs.DELETE_FIELD:
                target.pop(leaf, None)
                continue
            if isinstance(value, _Inc):
                value = (target.get(leaf) or 0) + value.by
            target[leaf] = value

    def delete(self):
        self.collection.docs.pop(self.id, None)


class FakeQuery:
    def __init__(self, collection, filters=(), max_docs=None, orders=(), after=None):
        self.collection, self.filters, self.max_docs = collection, filters, max_docs
        self.orders, self.after = orders, after

    def _copy(self, **kw):
        args = dict(filters=self.filters, max_docs=self.max_docs, orders=self.orders, after=self.after)
        args.update(kw)
        return FakeQuery(self.collection, **args)

    def where(self, field, op, value):
        return self._copy(filters=self.filters + ((field, op, value),))

    def select(self, *_args, **_kwargs):
        return self

    def order_by(self, field, direction="ASCENDING", **_kwargs):
        return self._copy(orders=self.orders + ((field, direction == "DESCENDING"),))

    def start_after(self, snapshot):
        return self._copy(after=snapshot)

    def limit(self, n):
        return self._copy(max_docs=n)

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
        for field, descending in reversed(self.orders):          # stable multi-key sort
            rows.sort(key=lambda r: r._data.get(field), reverse=descending)
        if self.after is not None:
            ids = [r.id for r in rows]
            if self.after.id in ids:
                rows = rows[ids.index(self.after.id) + 1:]
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

    def set(self, ref, data, merge=False):
        self.ops.append(("set", ref, data, merge))

    def update(self, ref, data):
        self.ops.append(("update", ref, data, False))

    def delete(self, ref):
        self.ops.append(("delete", ref, None, False))

    def commit(self):
        self.db.batch_sizes.append(len(self.ops))
        assert len(self.ops) <= 500, "Firestore batches are limited to 500 operations"
        for kind, ref, data, merge in self.ops:
            args = [data] if data is not None else []
            getattr(ref, kind)(*args, **({"merge": True} if merge else {}))
        self.ops = []


class FakeDB:
    def __init__(self):
        self.collections = {}
        self.batch_sizes = []

    def collection(self, name):
        return self.collections.setdefault(name, FakeCollection(name))

    def batch(self):
        return FakeBatch(self)
