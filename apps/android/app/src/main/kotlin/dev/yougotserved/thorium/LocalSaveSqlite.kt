package dev.yougotserved.thorium

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

private class LocalSaveDatabase(context: Context) : SQLiteOpenHelper(context, "local-saves-v1.sqlite", null, 1) {
    override fun onCreate(database: SQLiteDatabase) {
        database.execSQL("CREATE TABLE namespaces (package_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)")
        database.execSQL(
            "CREATE TABLE saves (package_id TEXT NOT NULL, save_key TEXT NOT NULL, " +
                "revision INTEGER NOT NULL, value_json TEXT NOT NULL, size_bytes INTEGER NOT NULL, " +
                "PRIMARY KEY(package_id, save_key))",
        )
    }
    override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        error("Unsupported local save database upgrade")
    }
}

private fun readSave(database: SQLiteDatabase, packageId: String, key: String): LocalSaveEntry? =
    database.rawQuery(
        "SELECT revision, value_json FROM saves WHERE package_id=? AND save_key=?", arrayOf(packageId, key),
    ).use { cursor ->
        if (cursor.moveToFirst()) LocalSaveEntry(cursor.getLong(0), cursor.getString(1)) else null
    }

private fun usage(database: SQLiteDatabase, packageId: String): LocalSaveUsage {
    database.execSQL("INSERT OR IGNORE INTO namespaces(package_id, revision) VALUES (?, 0)", arrayOf(packageId))
    return database.rawQuery(
        "SELECT revision, (SELECT COUNT(*) FROM saves WHERE package_id=?), " +
            "COALESCE((SELECT SUM(size_bytes) FROM saves WHERE package_id=?),0) " +
            "FROM namespaces WHERE package_id=?",
        arrayOf(packageId, packageId, packageId),
    ).use { cursor ->
        check(cursor.moveToFirst())
        LocalSaveUsage(cursor.getLong(0), cursor.getInt(1), cursor.getInt(2))
    }
}

private fun writeSave(
    database: SQLiteDatabase,
    packageId: String,
    command: LocalSaveCommand,
    mutation: LocalSaveMutation,
) {
    val values = ContentValues().apply {
        put("package_id", packageId)
        put("save_key", command.key)
        put("revision", mutation.revision)
        put("value_json", command.valueJson)
        put("size_bytes", mutation.valueBytes)
    }
    database.insertWithOnConflict("saves", null, values, SQLiteDatabase.CONFLICT_REPLACE).also {
        check(it != -1L)
    }
}

private fun mutate(database: SQLiteDatabase, packageId: String, command: LocalSaveCommand): LocalSaveResult {
    val current = readSave(database, packageId, command.key)
    val mutation = LocalSavePolicy.mutation(command, current, usage(database, packageId))
    val result = if (command.operation == LocalSaveOperation.REMOVE) {
        database.delete("saves", "package_id=? AND save_key=?", arrayOf(packageId, command.key))
        LocalSaveResult.Removed
    } else {
        writeSave(database, packageId, command, mutation)
        LocalSaveResult.Written(mutation.revision)
    }
    database.execSQL("UPDATE namespaces SET revision=? WHERE package_id=?", arrayOf<Any>(mutation.revision, packageId))
    return result
}

private fun transaction(database: SQLiteDatabase, packageId: String, command: LocalSaveCommand): LocalSaveResult {
    LocalSavePolicy.validate(command)
    database.beginTransaction()
    try {
        val result = if (command.operation == LocalSaveOperation.READ) {
            LocalSaveResult.Read(readSave(database, packageId, command.key))
        } else {
            mutate(database, packageId, command)
        }
        database.setTransactionSuccessful()
        return result
    } finally {
        database.endTransaction()
    }
}

/** A single process-wide instance is shared by both surfaces; SQLite commits CAS and quotas atomically. */
interface ManagedLocalSaveStore : LocalSaveNamespaces, AutoCloseable

fun createSqliteLocalSaveStore(context: Context): ManagedLocalSaveStore {
    val database = LocalSaveDatabase(context.applicationContext)
    return object : ManagedLocalSaveStore {
        override fun open(packageId: String): LocalSavePort =
            LocalSavePort { command -> transaction(database.writableDatabase, packageId, command) }

        override fun close() = database.close()
    }
}
