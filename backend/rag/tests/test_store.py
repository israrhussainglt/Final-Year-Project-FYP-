"""Store contracts (ported from repo.rag.test.ts + lib.core.test.ts vector math)."""

from app.store import RagStore, cosine_similarity, pack_vector, unpack_vector


def write(store: RagStore, **overrides):
    kwargs = dict(
        source_type="visit",
        source_id="r1",
        patient_id="p1",
        registration_id=None,
        label="Visit 2026-01-15",
        texts=["Patient had dengue symptoms and was advised rest."],
        embeddings=[[1.0, 0.0, 0.0]],
        embedding_model="fake-64",
    )
    kwargs.update(overrides)
    return store.replace_source(**kwargs)


class TestVectorMath:
    def test_pack_unpack_roundtrip_float32(self):
        v = [0.5, -0.25, 0.0, 1.5]
        packed = pack_vector(v)
        assert unpack_vector(packed) == list(map(float, unpack_vector(packed)))

    def test_cosine_edges(self):
        assert cosine_similarity([0, 0, 0], [1, 2, 3]) == 0
        assert abs(cosine_similarity([1, 0], [0, 1])) < 1e-9
        assert abs(cosine_similarity([1, 2, 3], [1, 2, 3]) - 1.0) < 1e-9


class TestReplaceSource:
    def test_writes_rows_and_fts_mirror(self, store):
        assert write(store) == 1
        assert store.source_chunk_count("visit", "r1") == 1
        hits = store.search_keyword("p1", "dengue", 5)
        assert len(hits) == 1
        assert "dengue" in hits[0]["content"]

    def test_reindexing_replaces_never_duplicates(self, store):
        write(store)
        write(store, texts=["Revised content only."], embeddings=None, embedding_model=None)
        assert store.source_chunk_count("visit", "r1") == 1
        assert store.search_keyword("p1", "dengue", 5) == []
        assert len(store.search_keyword("p1", "Revised", 5)) == 1

    def test_multi_part_labels_and_indexes(self, store):
        n = write(store, texts=["part one text", "part two text", "part three text"], embeddings=None)
        assert n == 3
        rows = store.list_chunks_for_patient("p1")
        assert [r["chunk_index"] for r in rows] == [0, 1, 2]
        assert rows[0]["label"] == "Visit 2026-01-15 (part 1)"
        assert rows[2]["label"] == "Visit 2026-01-15 (part 3)"


class TestScoping:
    def test_patient_filter_is_absolute(self, store):
        write(store, source_id="a", patient_id="pA", texts=["Asthma follow-up notes."])
        write(store, source_id="b", patient_id="pB")
        assert [r["source_id"] for r in store.list_chunks_for_patient("pA")] == ["a"]
        # pB's dengue chunk must not leak into pA's keyword search either way.
        assert store.search_keyword("pA", "dengue", 5) == []
        assert store.search_keyword("pB", "asthma", 5) == []

    def test_fts_injection_attempt_returns_nothing_dangerous(self, store):
        write(store)
        assert store.search_keyword("p1", '" OR 1=1 --', 5) == []
        assert store.search_keyword("p1", "dengue", 5)

    def test_registration_scoped_rows_invisible_to_patient_reads(self, store, registration_id):
        write(store, patient_id=None, registration_id=registration_id)
        assert store.list_chunks_for_patient("p1") == []
        assert store.list_source_ids_for_patient("p1") == []


class TestLifecycle:
    def test_reparent_promotes_registration_chunks(self, store, registration_id):
        write(store, patient_id=None, registration_id=registration_id)
        assert store.reparent_registration(registration_id, "p-real") == 1
        assert [r["source_id"] for r in store.list_chunks_for_patient("p-real")] == ["r1"]

    def test_delete_source_removes_rows_and_fts(self, store):
        write(store)
        assert store.delete_source("visit", "r1") == 1
        assert store.source_chunk_count("visit", "r1") == 0
        assert store.search_keyword("p1", "dengue", 5) == []

    def test_missing_embedding_counting(self, store):
        write(store, embeddings=None, embedding_model=None)
        assert store.missing_embedding_count("p1") == 1
        write(store)
        assert store.missing_embedding_count("p1") == 0
