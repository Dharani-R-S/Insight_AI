"""
Phase 1 Architecture Test Suite.
Verifies DuckDB Engine, Password Hashing, JWT Auth, and FastAPI endpoints.
"""

import asyncio
import os
from pathlib import Path
import tempfile
from app.core.security import create_access_token, get_password_hash, verify_password, decode_access_token
from app.services.duckdb_engine import DuckDBEngine
from app.schemas.auth import UserCreate, UserLogin
from app.db.session import Base, SessionLocal, engine
from app.models.user import User
from app.services.auth_service import AuthService


def test_security():
    print("--- 1. Testing Password Hashing & JWT Token Generation ---")
    password = "SuperSecretPassword123!"
    hashed = get_password_hash(password)
    assert verify_password(password, hashed) is True
    assert verify_password("WrongPassword", hashed) is False
    print("[OK] Password hashing & verification working perfectly.")

    user_id = "test-user-uuid-1234"
    token = create_access_token(subject=user_id)
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == user_id
    print("[OK] JWT token creation & decoding working perfectly.")


def test_auth_service():
    print("\n--- 2. Testing Auth Service (Signup/Login) ---")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        email = "testuser@insightai.com"
        # Cleanup if exists from prior runs
        db.query(User).filter(User.email == email).delete()
        db.commit()

        user_in = UserCreate(email=email, password="MySecurePassword123", full_name="Test User")
        user_resp = AuthService.register_user(db=db, user_in=user_in)
        assert user_resp.email == email
        print("[OK] Signup service successful.")

        login_credentials = UserLogin(email=email, password="MySecurePassword123")
        token_resp = AuthService.authenticate_user(db=db, credentials=login_credentials)
        assert token_resp.access_token is not None
        assert token_resp.user.email == email
        print("[OK] Login service & JWT issuance successful.")
    finally:
        db.close()


async def test_duckdb_engine():
    print("\n--- 3. Testing Stateless DuckDB Engine ---")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "sales_sample.csv"
        parquet_path = tmp_path / "sales_sample.parquet"

        # Create dummy CSV file
        csv_content = (
            "id,region,sales,category\n"
            "1,North,150.5,Electronics\n"
            "2,South,200.0,Furniture\n"
            "3,North,350.25,Electronics\n"
            "4,West,99.99,Supplies\n"
            "5,South,500.0,Electronics\n"
        )
        csv_path.write_text(csv_content, encoding="utf-8")

        # Ingest CSV to Parquet statelessly
        ingest_res = await DuckDBEngine.ingest_file_to_parquet(
            file_path=csv_path,
            output_parquet_path=parquet_path,
        )
        assert ingest_res["total_rows"] == 5
        assert ingest_res["total_columns"] == 4
        print("[OK] DuckDB stateless ingestion to Parquet successful.")

        # Execute vectorized DuckDB SELECT query
        sql = "SELECT category, SUM(sales) as total_sales, COUNT(*) as record_count FROM dataset GROUP BY category ORDER BY total_sales DESC"
        query_res = await DuckDBEngine.execute_query(
            sql_query=sql,
            parquet_path=parquet_path,
            table_name="dataset",
        )
        assert query_res.row_count == 3
        assert "category" in query_res.columns
        assert "total_sales" in query_res.columns
        print(f"[OK] DuckDB query executed in {query_res.execution_time_ms}ms:")
        for row in query_res.rows:
            print(f"   {row}")

        # Test Schema inspection
        schema_res = await DuckDBEngine.get_schema(dataset_id="test_ds", parquet_path=parquet_path)
        assert schema_res.total_rows == 5
        print("[OK] DuckDB schema inspection successful.")


async def main():
    test_security()
    test_auth_service()
    await test_duckdb_engine()
    print("\n==========================================")
    print("ALL PHASE 1 ARCHITECTURE TESTS PASSED SUCCESSFULLY!")
    print("==========================================")


if __name__ == "__main__":
    asyncio.run(main())
