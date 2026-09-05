cmake_minimum_required(VERSION 3.25)

include("${CMAKE_CURRENT_LIST_DIR}/../ClientLibraryPlatform.cmake")

function(assert_equal actual expected description)
  if(NOT "${actual}" STREQUAL "${expected}")
    message(FATAL_ERROR
      "${description}: expected '${expected}', got '${actual}'")
  endif()
endfunction()

function(resolve_platform system_name pointer_size processor osx_architectures)
  mu_resolve_client_library_platform(
    SYSTEM_NAME "${system_name}"
    POINTER_SIZE "${pointer_size}"
    SYSTEM_PROCESSOR "${processor}"
    OSX_ARCHITECTURES "${osx_architectures}"
    OUT_LIBRARY_NAME actual_library
    OUT_RID actual_rid
    OUT_PLATFORM actual_platform
    OUT_EXTRA_ARGS actual_extra_args)

  set(ACTUAL_LIBRARY "${actual_library}" PARENT_SCOPE)
  set(ACTUAL_RID "${actual_rid}" PARENT_SCOPE)
  set(ACTUAL_PLATFORM "${actual_platform}" PARENT_SCOPE)
  set(ACTUAL_EXTRA_ARGS "${actual_extra_args}" PARENT_SCOPE)
endfunction()

resolve_platform("Darwin" 8 "arm64" "")
assert_equal("${ACTUAL_LIBRARY}" "MUnique.Client.Library.dylib" "macOS library name")
assert_equal("${ACTUAL_RID}" "osx-arm64" "Apple Silicon RID")
assert_equal("${ACTUAL_PLATFORM}" "arm64" "Apple Silicon platform")
assert_equal("${ACTUAL_EXTRA_ARGS}" "-p:ci=true" "macOS build arguments")

resolve_platform("Darwin" 8 "arm64" "x86_64")
assert_equal("${ACTUAL_RID}" "osx-x64" "Explicit Intel macOS RID")
assert_equal("${ACTUAL_PLATFORM}" "x64" "Explicit Intel macOS platform")

resolve_platform("Linux" 8 "x86_64" "")
assert_equal("${ACTUAL_LIBRARY}" "MUnique.Client.Library.so" "Linux library name")
assert_equal("${ACTUAL_RID}" "linux-x64" "Linux RID")

resolve_platform("Windows" 8 "AMD64" "")
assert_equal("${ACTUAL_LIBRARY}" "MUnique.Client.Library.dll" "Windows library name")
assert_equal("${ACTUAL_RID}" "win-x64" "Windows x64 RID")

resolve_platform("Windows" 4 "x86" "")
assert_equal("${ACTUAL_RID}" "win-x86" "Windows x86 RID")
