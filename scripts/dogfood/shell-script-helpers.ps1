function ConvertTo-LfText {
    param(
        [AllowNull()][string]$Text
    )

    if ($null -eq $Text) {
        return ""
    }

    return ($Text -replace "`r`n", "`n") -replace "`r", "`n"
}

function Write-LfTextFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowNull()][string]$Text
    )

    $lfText = ConvertTo-LfText $Text
    [System.IO.File]::WriteAllText($Path, $lfText, [System.Text.UTF8Encoding]::new($false))
}
